function isLink(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.href === 'string'
  );
}

function plainCellText(value, separator) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => plainCellText(item, separator)).join(separator);
  }
  if (isLink(value)) {
    return value.text?.trim() || value.href;
  }
  return String(value);
}

function escapeMarkdownText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n?|\n/g, '<br>');
}

function markdownCell(value) {
  if (isLink(value)) {
    const href = value.href.trim();
    const text = value.text?.trim();
    if (!text || text === href) {
      return escapeMarkdownText(href);
    }
    return `[${escapeMarkdownText(text)}](${href})`;
  }
  return escapeMarkdownText(plainCellText(value, '、'));
}

function csvCellText(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(csvCellText).join('；');
  }
  if (isLink(value)) {
    const href = value.href.trim();
    const text = value.text?.trim();
    return text && text !== href ? `${text} <${href}>` : href;
  }
  return String(value);
}

function escapeCsvCell(value) {
  const text = csvCellText(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function markdownGrid(columns, records) {
  const headers = columns.map(({ name }) => markdownCell(name));
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`
  ];
  for (const record of records) {
    const cells = columns.map(({ id }) => markdownCell(record.values[id]));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function csvGrid(columns, records) {
  const rows = [columns.map(({ name }) => escapeCsvCell(name)).join(',')];
  for (const record of records) {
    rows.push(columns.map(({ id }) => escapeCsvCell(record.values[id])).join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}

function outputSheets(table) {
  return table.sheets?.length > 0 ? table.sheets : [table];
}

export function tableToMarkdown(table) {
  const scope =
    table.exportScope ?? '当前表格视图（保留筛选、分组和排序）';
  const sheets = outputSheets(table);
  const lines = [
    `# ${escapeMarkdownText(table.title)}`,
    '',
    `> 来源：${table.sourceUrl}`,
    `> 导出范围：${scope}`,
    ''
  ];

  if (sheets.length === 1) {
    lines.push(markdownGrid(sheets[0].columns, sheets[0].records), '');
  } else {
    for (const sheet of sheets) {
      lines.push(
        `## ${escapeMarkdownText(sheet.name || 'Sheet')}`,
        '',
        markdownGrid(sheet.columns, sheet.records),
        ''
      );
    }
  }

  return lines.join('\n');
}

export function tableToCsv(table) {
  const sheets = outputSheets(table);
  if (sheets.length === 1) {
    return `\uFEFF${csvGrid(sheets[0].columns, sheets[0].records)}`;
  }
  return `\uFEFF${sheets
    .map(
      (sheet) =>
        `--- ${sheet.name || 'Sheet'} ---\r\n${csvGrid(sheet.columns, sheet.records)}`
    )
    .join('\r\n')}`;
}
