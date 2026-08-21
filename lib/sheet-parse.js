import { TableCaptureError } from './table-capture.js';

const SHEET_TYPES = new Set(['Sheet', 'Table']);
const SHEET_FORMATS = new Set(['lakesheet', 'laketable']);

export function isStructuredDoc(doc) {
  return (
    SHEET_TYPES.has(doc?.type) ||
    SHEET_FORMATS.has(doc?.format) ||
    Boolean(pickPayload(doc))
  );
}

export function hasConvertiblePayload(doc) {
  return Boolean(pickPayload(doc));
}

function pickPayload(doc) {
  const typed = SHEET_TYPES.has(doc?.type) || SHEET_FORMATS.has(doc?.format);
  const content = typed ? doc?.content || doc?.body_asl : undefined;
  const typedBody = typed && isLikelySheetPayload(doc?.body) ? doc.body : undefined;
  return (
    doc?.body_sheet ||
    doc?.body_table ||
    content ||
    typedBody ||
    (isLikelySheetPayload(doc?.content) ? doc.content : undefined) ||
    (isLikelySheetPayload(doc?.body_asl) ? doc.body_asl : undefined)
  );
}

function isLikelySheetPayload(value) {
  if (value && typeof value === 'object') {
    return true;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function parsePayload(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function binaryStringToBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export async function inflateZlibBytes(bytes, inflate) {
  if (typeof inflate === 'function') {
    return inflate(bytes);
  }
  if (typeof DecompressionStream === 'function') {
    for (const format of ['deflate', 'deflate-raw']) {
      try {
        const stream = new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream(format));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
      } catch {
        // Try the next deflate variant.
      }
    }
  }
  throw new TableCaptureError(
    'SHEET_INFLATE_UNSUPPORTED',
    '当前环境无法解压语雀表格数据'
  );
}

async function decompressLakeSheet(parsed, inflate) {
  if (!parsed || typeof parsed !== 'object' || typeof parsed.sheet !== 'string') {
    return parsed;
  }
  const inflated = await inflateZlibBytes(
    binaryStringToBytes(parsed.sheet),
    inflate
  );
  return {
    ...parsed,
    sheet: JSON.parse(inflated)
  };
}

function lakeCellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) {
    return '';
  }
  const value = cell.v;
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'object') {
    if (value.class === 'select') {
      const selected = Array.isArray(value.value) ? value.value : [];
      return selected.length <= 1 ? selected[0] ?? '' : selected;
    }
    const href = value.url || value.href;
    if (href) {
      return {
        text: String(value.text ?? href),
        href: String(href)
      };
    }
    if (value.text) {
      return value.text;
    }
  }
  return String(value);
}

function uniqueColumnName(name, usedNames) {
  const base = name || '未命名';
  const occurrence = (usedNames.get(base) ?? 0) + 1;
  usedNames.set(base, occurrence);
  return occurrence === 1 ? base : `${base} (${occurrence})`;
}

function columnsFromHeader(header) {
  const usedNames = new Map();
  return header.map((name, index) => ({
    id: `column-${index}`,
    name: uniqueColumnName(
      String(name ?? '').trim() || `列${index + 1}`,
      usedNames
    )
  }));
}

function recordsFromRows(rows, columns) {
  return rows.map((row, rowIndex) => ({
    key: `row-${rowIndex}`,
    values: Object.fromEntries(
      columns.map((column, columnIndex) => [column.id, row[columnIndex] ?? ''])
    )
  }));
}

function matrixToSheet(name, matrix) {
  const rows = Array.isArray(matrix) ? matrix : [];
  const width = rows.reduce(
    (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
    0
  );
  const normalized = rows.map((row) => {
    const cells = Array.isArray(row) ? row : [];
    return Array.from({ length: width }, (_, index) => cells[index] ?? '');
  });
  const contentRows = normalized.filter((row) =>
    row.some((cell) => cell !== '')
  );
  if (contentRows.length === 0) {
    return undefined;
  }
  const columns = columnsFromHeader(contentRows[0]);
  return {
    name: name || 'Sheet1',
    columns,
    records: recordsFromRows(contentRows.slice(1), columns)
  };
}

function gridToMatrix(sheet) {
  const data = sheet?.data ?? {};
  let maxRow = -1;
  let maxCol = -1;
  for (const [rowKey, row] of Object.entries(data)) {
    const rowIndex = Number(rowKey);
    if (!Number.isInteger(rowIndex) || !row || typeof row !== 'object') {
      continue;
    }
    for (const [columnKey, cell] of Object.entries(row)) {
      if (lakeCellValue(cell) === '') {
        continue;
      }
      const columnIndex = Number(columnKey);
      if (!Number.isInteger(columnIndex)) {
        continue;
      }
      maxRow = Math.max(maxRow, rowIndex);
      maxCol = Math.max(maxCol, columnIndex);
    }
  }
  if (maxRow < 0 || maxCol < 0) {
    return [];
  }
  const matrix = [];
  for (let rowIndex = 0; rowIndex <= maxRow; rowIndex += 1) {
    const row = [];
    for (let columnIndex = 0; columnIndex <= maxCol; columnIndex += 1) {
      row.push(lakeCellValue(data[rowIndex]?.[columnIndex]));
    }
    matrix.push(row);
  }
  return matrix;
}

function resolveDataTableValue(value, column) {
  if (value === undefined || value === null) {
    return '';
  }
  switch (column?.type) {
    case 'select': {
      const option = (column.options ?? []).find((item) => item.id === value);
      return option ? option.value : value;
    }
    case 'multiSelect': {
      const options = column.options ?? [];
      const ids = Array.isArray(value) ? value : [value];
      const labels = ids.map((id) => {
        const option = options.find((item) => item.id === id);
        return option ? option.value : id;
      });
      return labels.length <= 1 ? labels[0] ?? '' : labels;
    }
    case 'date': {
      if (typeof value === 'object' && value.text) {
        return value.text;
      }
      if (typeof value === 'object' && value.time) {
        return String(value.time).split('T')[0];
      }
      return String(value);
    }
    case 'checkbox':
      return value ? '✓' : '';
    case 'mention':
      if (typeof value === 'object') {
        return value.name || value.login || '';
      }
      return String(value);
    default:
      if (typeof value === 'object') {
        if (value.url || value.href) {
          return {
            text: String(value.text ?? value.url ?? value.href),
            href: String(value.url ?? value.href)
          };
        }
        if (value.text) {
          return value.text;
        }
        return JSON.stringify(value);
      }
      return value;
  }
}

function convertDataTableSheet(sheet, index) {
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  if (columns.length === 0) {
    return undefined;
  }
  const usedNames = new Map();
  const mappedColumns = columns.map((column, columnIndex) => ({
    id: `column-${columnIndex}`,
    name: uniqueColumnName(column.name || column.id || `列${columnIndex + 1}`, usedNames),
    sourceId: column.id
  }));
  const records = (Array.isArray(sheet.records) ? sheet.records : []).map(
    (record, rowIndex) => {
      let data = record?.data ?? {};
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          data = {};
        }
      }
      return {
        key: String(record?.id ?? `row-${rowIndex}`),
        values: Object.fromEntries(
          mappedColumns.map((column, columnIndex) => {
            const source = columns[columnIndex];
            const cell = data[source.id];
            const raw =
              cell && typeof cell === 'object' && 'value' in cell
                ? cell.value
                : cell;
            return [column.id, resolveDataTableValue(raw, source)];
          })
        )
      };
    }
  );
  return {
    name: sheet.name || `数据表${index + 1}`,
    columns: mappedColumns.map(({ id, name }) => ({ id, name })),
    records
  };
}

function isDataTablePayload(parsed) {
  return (
    parsed?.format === 'laketable' ||
    parsed?.type === 'Table' ||
    (Array.isArray(parsed?.sheet) && parsed.sheet[0]?.columns)
  );
}

function convertOpenApiSheets(parsed) {
  return (parsed?.data ?? [])
    .map((sheet, index) =>
      matrixToSheet(sheet?.name || `Sheet${index + 1}`, sheet?.table)
    )
    .filter(Boolean);
}

function convertLakeSheets(parsed) {
  const raw = Array.isArray(parsed?.sheet) ? parsed.sheet : [parsed?.sheet];
  return raw
    .map((sheet, index) =>
      matrixToSheet(sheet?.name || `Sheet${index + 1}`, gridToMatrix(sheet))
    )
    .filter(Boolean);
}

function convertDataTable(parsed) {
  const sheets = Array.isArray(parsed?.sheet) ? parsed.sheet : [parsed?.sheet];
  return sheets.map((sheet, index) => convertDataTableSheet(sheet, index)).filter(Boolean);
}

function tableFromSheets(sheets, doc, { title, sourceUrl }) {
  const primary = sheets[0];
  const isSheet = doc?.type === 'Sheet' || doc?.format === 'lakesheet';
  return {
    title: title || doc?.title || primary.name || '语雀表格',
    sourceUrl,
    viewName: isSheet ? '表格' : '表格视图',
    exportScope: isSheet
      ? '语雀表格（完整工作表）'
      : '语雀数据表（接口完整记录）',
    filtersActive: false,
    columns: primary.columns,
    records: primary.records,
    sheets
  };
}

export async function convertStructuredDoc(doc, options = {}) {
  const parsed = parsePayload(pickPayload(doc));
  if (!parsed) {
    throw new TableCaptureError('EMPTY_SHEET', '未读取到语雀表格数据');
  }

  let sheets = [];
  if (isDataTablePayload(parsed)) {
    sheets = convertDataTable(parsed);
  } else if (Array.isArray(parsed?.data) && parsed.data[0]?.table) {
    sheets = convertOpenApiSheets(parsed);
  } else {
    const lake = await decompressLakeSheet(parsed, options.inflate);
    sheets = convertLakeSheets(lake);
  }

  if (sheets.length === 0) {
    throw new TableCaptureError('EMPTY_SHEET', '未读取到语雀表格数据');
  }

  return tableFromSheets(sheets, doc, options);
}
