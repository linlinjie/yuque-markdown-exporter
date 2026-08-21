import {
  collectVirtualRecords,
  TableCaptureError
} from './table-capture.js';

function normalizeViewLabel(value) {
  return String(value ?? '')
    .replace(/\s+remove\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tabIsSelected(tab) {
  return (
    tab.getAttribute?.('aria-selected') === 'true' ||
    tab.matches?.('[aria-selected="true"]') === true
  );
}

export function inspectStructuredPage(doc = document) {
  const tabs = [...doc.querySelectorAll('[role="tab"]')];
  const labels = tabs.map((tab) => normalizeViewLabel(tab.textContent));
  const activeIndex = tabs.findIndex(tabIsSelected);
  const activeView = activeIndex >= 0 ? labels[activeIndex] : null;
  const hasTableView = labels.includes('表格视图');
  const hasStructuredView = labels.some(
    (label) => label === '表格视图' || label === '看板视图'
  );

  return {
    structured: hasTableView && hasStructuredView,
    activeView,
    hasTableView
  };
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

function readCellValue(cell) {
  if (!cell) {
    return '';
  }

  const anchors = [...(cell.querySelectorAll?.('a[href]') ?? [])];
  if (anchors.length === 1) {
    const anchor = anchors[0];
    const href = anchor.href || anchor.getAttribute?.('href') || '';
    if (href) {
      return {
        text: normalizeText(anchor.textContent) || href,
        href
      };
    }
  }

  const badges = [
    ...(cell.querySelectorAll?.(
      '[role="listitem"], [data-value], [class*="tag-item"], [class*="select-item"]'
    ) ?? [])
  ]
    .map((badge) => normalizeText(badge.innerText ?? badge.textContent))
    .filter(Boolean);
  if (badges.length > 1) {
    return [...new Set(badges)];
  }

  return normalizeText(cell.innerText ?? cell.textContent);
}

export function normalizeRenderedRow(
  { rowIndex, primaryText, cells },
  columns
) {
  const index = String(rowIndex ?? '').trim();
  if (!/^\d+$/.test(index)) {
    return null;
  }

  const normalizedPrimary = normalizeText(primaryText);
  const values = {};
  columns.forEach(({ id }, columnIndex) => {
    values[id] = readCellValue(cells[columnIndex]);
  });

  return {
    key: `${index}:${normalizedPrimary}`,
    values
  };
}

function tableRows(table) {
  return [...new Set(table.querySelectorAll('[role="row"], tr'))];
}

function directChildren(element) {
  return [...(element?.children ?? [])];
}

function elementRect(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) {
    return null;
  }
  const left = Number(rect.left);
  const top = Number(rect.top);
  const right = Number(rect.right ?? left + Number(rect.width));
  const bottom = Number(rect.bottom ?? top + Number(rect.height));
  if (![left, top, right, bottom].every(Number.isFinite)) {
    return null;
  }
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function elementVisible(element, doc) {
  const rect = elementRect(element);
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const view = doc.defaultView;
  const viewportWidth = Number(view?.innerWidth);
  const viewportHeight = Number(view?.innerHeight);
  return (
    (!Number.isFinite(viewportWidth) || (rect.right > 0 && rect.left < viewportWidth)) &&
    (!Number.isFinite(viewportHeight) || (rect.bottom > 0 && rect.top < viewportHeight))
  );
}

function rowCells(row) {
  const cells = [
    ...(row.querySelectorAll?.(
      '[role="gridcell"], [role="cell"], td, th'
    ) ?? [])
  ];
  const uniqueCells = [...new Set(cells)];
  if (uniqueCells.length === 1) {
    const outerCell = uniqueCells[0];
    const children = directChildren(outerCell).filter((child) => {
      const rect = elementRect(child);
      return rect && rect.width > 0 && rect.height > 0;
    });
    const centers = children.map((child) => {
      const rect = elementRect(child);
      return (rect.left + rect.right) / 2;
    });
    const horizontalChildren =
      children.length > 1 &&
      new Set(centers.map((center) => Math.round(center))).size > 1;
    if (horizontalChildren) {
      return children;
    }
  }
  return uniqueCells.length > 0 ? uniqueCells : directChildren(row);
}

function rowDescriptors(root, doc, paneIndex) {
  const rows = [
    ...new Set(root.querySelectorAll?.('[role="row"], tr') ?? [])
  ];
  return rows
    .map((row, index) => {
      if (!elementVisible(row, doc)) {
        return null;
      }
      const rect = elementRect(row);
      const cells = rowCells(row).filter((cell) => elementVisible(cell, doc));
      return {
        source: row,
        cells,
        paneIndex,
        index,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        header:
          index === 0 ||
          cells.some(
            (cell) =>
              cell.getAttribute?.('role') === 'columnheader' ||
              String(cell.tagName).toUpperCase() === 'TH'
          )
      };
    })
    .filter(Boolean);
}

export function clusterRows(rowDescriptors, tolerance = 3) {
  const bands = [];
  const sorted = [...rowDescriptors].sort(
    (left, right) => left.top - right.top || left.left - right.left
  );

  for (const descriptor of sorted) {
    const current = bands.at(-1);
    const currentCenter = current
      ? (current.top + current.bottom) / 2
      : undefined;
    const descriptorCenter = (descriptor.top + descriptor.bottom) / 2;
    const overlaps =
      current &&
      ((descriptor.top < current.bottom && descriptor.bottom > current.top) ||
        Math.abs(descriptorCenter - currentCenter) <= tolerance);
    if (!overlaps) {
      bands.push({
        top: descriptor.top,
        bottom: descriptor.bottom,
        sources: [descriptor]
      });
      continue;
    }
    current.top = Math.min(current.top, descriptor.top);
    current.bottom = Math.max(current.bottom, descriptor.bottom);
    current.sources.push(descriptor);
  }

  return bands;
}

export function cellValueForColumn(rowBand, column) {
  for (const source of rowBand.sources ?? []) {
    for (const cell of source.cells ?? []) {
      const rect = elementRect(cell);
      if (!rect) {
        continue;
      }
      const center = (rect.left + rect.right) / 2;
      const overlapsRow = rect.top < rowBand.bottom && rect.bottom > rowBand.top;
      if (
        overlapsRow &&
        center >= column.left &&
        center < column.right
      ) {
        return cell;
      }
    }
  }
  return undefined;
}

function scalarRecordText(value) {
  if (Array.isArray(value)) {
    return value.join('、');
  }
  if (value && typeof value === 'object') {
    return value.text || value.href || '';
  }
  return String(value ?? '');
}

function stableRowAttribute(source) {
  for (const name of ['aria-rowindex', 'data-row-index', 'data-index']) {
    const value = source?.getAttribute?.(name);
    if (/^\d+$/.test(String(value ?? '').trim())) {
      return String(value).trim();
    }
  }
  return null;
}

export function sampleLayoutRecords(layout, columns) {
  const records = [];
  const occurrences = new Map();

  for (const rowBand of layout.rows ?? []) {
    const sources = [...(rowBand.sources ?? [])].sort(
      (left, right) => left.left - right.left
    );
    const values = Object.fromEntries(columns.map(({ id }) => [id, '']));
    for (const column of columns) {
      const cell = cellValueForColumn(rowBand, column);
      values[column.id] = readCellValue(cell);
    }

    const primaryText = normalizeText(
      scalarRecordText(values[columns[0]?.id] ?? '')
    );
    if (!primaryText) {
      continue;
    }

    const rowIndex = sources
      .map(({ source }) => stableRowAttribute(source))
      .find(Boolean);
    let key;
    if (rowIndex !== undefined && rowIndex !== null) {
      key = `row-${rowIndex}`;
    } else {
      const occurrence = (occurrences.get(primaryText) ?? 0) + 1;
      occurrences.set(primaryText, occurrence);
      if (occurrence > 1) {
        throw new TableCaptureError(
          'UNSTABLE_RECORD_ID',
          '无法稳定识别重复记录',
          { diagnostic: layout.diagnostic }
        );
      }
      key = `${primaryText}:${occurrence}`;
    }

    records.push({ key, values });
  }

  return records;
}

function columnName(cell) {
  return normalizeText(cell?.innerText ?? cell?.textContent);
}

export function discoverTableLayout(doc = document) {
  const roots = [
    ...new Set(doc.querySelectorAll?.('table, [role="grid"]') ?? [])
  ].filter((root) => elementVisible(root, doc));
  const panes = [];
  const columnCandidates = [];
  const recordRows = [];

  roots.forEach((root, paneIndex) => {
    const rect = elementRect(root);
    const rows = rowDescriptors(root, doc, paneIndex);
    const header = rows.find((row) => row.header);
    for (const cell of header?.cells ?? []) {
      const cellRect = elementRect(cell);
      const name = columnName(cell);
      if (!cellRect || !name) {
        continue;
      }
      columnCandidates.push({
        name,
        left: cellRect.left,
        right: cellRect.right,
        paneIndex
      });
    }
    recordRows.push(...rows.filter((row) => !row.header));
    panes.push({ element: root, rect, rows });
  });

  const columns = [];
  const usedNames = new Map();
  for (const candidate of columnCandidates.sort(
    (left, right) => left.left - right.left || left.paneIndex - right.paneIndex
  )) {
    const duplicate = columns.find(
      (column) =>
        column.name === candidate.name &&
        Math.abs(column.left - candidate.left) <= 2 &&
        Math.abs(column.right - candidate.right) <= 2
    );
    if (duplicate) {
      continue;
    }
    const occurrence = (usedNames.get(candidate.name) ?? 0) + 1;
    usedNames.set(candidate.name, occurrence);
    columns.push({
      id: `column-${columns.length}`,
      name:
        occurrence === 1
          ? candidate.name
          : `${candidate.name} (${occurrence})`,
      left: candidate.left,
      right: candidate.right
    });
  }

  const requiredPaneCount = new Set(
    columnCandidates.map(({ paneIndex }) => paneIndex)
  ).size;
  const rows = clusterRows(recordRows).filter(
    (row) =>
      new Set(row.sources.map(({ paneIndex }) => paneIndex)).size >=
      Math.max(1, requiredPaneCount)
  );
  return {
    columns,
    panes,
    rows,
    diagnostic: describeDocumentShape(doc)
  };
}

function textKind(element) {
  const text = normalizeText(element?.innerText ?? element?.textContent);
  if (!text) {
    return 'empty';
  }
  return /^\d+$/.test(text) ? 'number' : 'text';
}

function describeElementShape(element, depth = 2) {
  const tag = String(element?.tagName ?? 'node').toLowerCase();
  const role = element?.getAttribute?.('role');
  const children = directChildren(element);
  const label = `${tag}${role ? `(${role})` : ''}:${textKind(element)}`;
  if (depth === 0 || children.length === 0) {
    return label;
  }
  const visibleChildren = children
    .slice(0, 10)
    .map((child) => describeElementShape(child, depth - 1));
  if (children.length > visibleChildren.length) {
    visibleChildren.push(`+${children.length - visibleChildren.length}`);
  }
  return `${label}[${visibleChildren.join(',')}]`;
}

export function describeDocumentShape(doc) {
  const tables = [...(doc.querySelectorAll?.('table') ?? [])];
  const tableShapes = tables.slice(0, 8).map((table, tableIndex) => {
    const rows = tableRows(table);
    const samples = rows
      .slice(0, 4)
      .map((row, rowIndex) => `r${rowIndex}=${describeElementShape(row)}`);
    return `t${tableIndex}{rows=${rows.length};${samples.join(';')}}`;
  });
  return [`tables=${tables.length}`, ...tableShapes].join(';').slice(0, 12_000);
}

function interactiveButtons(element) {
  return [...element.querySelectorAll('button, [role="button"]')];
}

function recordIndexPosition(element) {
  return directChildren(element)
    .slice(0, 3)
    .findIndex((child) =>
      /^\d+$/.test(normalizeText(child.innerText ?? child.textContent))
    );
}

function buttonHasRecordIndex(button) {
  return recordIndexPosition(button) >= 0;
}

export function extractTableColumns(table) {
  const headerRow = tableRows(table).find((row) => {
    const buttons = interactiveButtons(row);
    return buttons.length >= 2 && !buttons.some(buttonHasRecordIndex);
  });
  if (!headerRow) {
    return [];
  }

  const usedNames = new Map();
  return interactiveButtons(headerRow)
    .map((button) => normalizeText(button.innerText ?? button.textContent))
    .filter(Boolean)
    .map((name, index) => {
      const occurrence = (usedNames.get(name) ?? 0) + 1;
      usedNames.set(name, occurrence);
      return {
        id: `column-${index}`,
        name: occurrence === 1 ? name : `${name} (${occurrence})`
      };
    });
}

export function extractRenderedRecords(table, columns) {
  const records = [];

  for (const row of tableRows(table)) {
    const recordContainer = [row, ...interactiveButtons(row)].find(
      buttonHasRecordIndex
    );
    if (!recordContainer) {
      continue;
    }

    const children = directChildren(recordContainer);
    const indexPosition = recordIndexPosition(recordContainer);
    const cells = children.slice(
      indexPosition + 1,
      indexPosition + 1 + columns.length
    );
    const record = normalizeRenderedRow(
      {
        rowIndex: normalizeText(
          children[indexPosition]?.innerText ??
            children[indexPosition]?.textContent
        ),
        primaryText: normalizeText(cells[0]?.innerText),
        cells
      },
      columns
    );
    if (record) {
      records.push(record);
    }
  }

  return records;
}

function findViewTab(doc, label) {
  return [...doc.querySelectorAll('[role="tab"]')].find(
    (tab) => normalizeViewLabel(tab.textContent) === label
  );
}

function baseUrl(value) {
  return String(value ?? '').split('#')[0];
}

function pageHasFilters(doc) {
  return [...doc.querySelectorAll('button')].some((button) => {
    const label = normalizeText(button.innerText ?? button.textContent);
    const match = label.match(/^(\d+)个筛选$/);
    return match ? Number(match[1]) > 0 : false;
  });
}

function isVerticalScroller(element, view) {
  if (!element || element.scrollHeight <= element.clientHeight + 1) {
    return false;
  }
  const overflowY = view?.getComputedStyle?.(element)?.overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

function isHorizontalScroller(element, view) {
  if (!element || element.scrollWidth <= element.clientWidth + 1) {
    return false;
  }
  const overflowX = view?.getComputedStyle?.(element)?.overflowX;
  return overflowX === 'auto' || overflowX === 'scroll';
}

function findVerticalScroller(table, view) {
  const descendants = [
    ...(table.querySelectorAll?.(
      '[data-testid="virtuoso-scroller"], [class*="scroller"], [class*="scroll"]'
    ) ?? [])
  ];
  let ancestor = table.parentElement;
  const ancestors = [];
  for (let depth = 0; ancestor && depth < 10; depth += 1) {
    ancestors.push(ancestor);
    ancestor = ancestor.parentElement;
  }
  return [...descendants, ...ancestors].find((element) =>
    isVerticalScroller(element, view)
  );
}

function findPaneScrollers(pane, view) {
  const descendants = [
    ...(pane?.querySelectorAll?.(
      '[data-testid="virtuoso-scroller"], [class*="scroller"], [class*="scroll"]'
    ) ?? [])
  ];
  const ancestors = [];
  let ancestor = pane?.parentElement;
  for (let depth = 0; ancestor && depth < 10; depth += 1) {
    ancestors.push(ancestor);
    ancestor = ancestor.parentElement;
  }

  return [...new Set([...descendants, ...ancestors])].filter(
    (element) =>
      isVerticalScroller(element, view) || isHorizontalScroller(element, view)
  );
}

function captureScrollPositions(layout, view) {
  const elements = [
    ...new Set(
      (layout.panes ?? []).flatMap(({ element }) =>
        findPaneScrollers(element, view)
      )
    )
  ];
  return elements.map((element) => ({
    element,
    top: element.scrollTop,
    left: element.scrollLeft,
    vertical: isVerticalScroller(element, view),
    horizontal: isHorizontalScroller(element, view)
  }));
}

function restoreScrollPositions(positions) {
  for (const { element, top, left } of positions ?? []) {
    element.scrollTop = top;
    if ('scrollLeft' in element) {
      element.scrollLeft = left;
    }
  }
}

function alignLayoutColumns(currentColumns, columns) {
  const byName = new Map(columns.map((column) => [column.name, column]));
  return currentColumns
    .map((column) => {
      const master = byName.get(column.name);
      if (!master) {
        const next = {
          ...column,
          id: `column-${columns.length}`
        };
        columns.push(next);
        byName.set(next.name, next);
        return next;
      }
      return {
        ...column,
        id: master.id
      };
    });
}

function atHorizontalEnd(element) {
  return element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
}

function atVerticalEnd(element) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
}

function defaultRenderSleep(doc) {
  const view = doc.defaultView;
  return new Promise((resolve) => {
    const finish = () => setTimeout(resolve, 80);
    if (!view?.requestAnimationFrame) {
      finish();
      return;
    }
    view.requestAnimationFrame(() => view.requestAnimationFrame(finish));
  });
}

async function waitForTable({ doc, sleep, now, timeoutMs = 10_000 }) {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    const table = doc.querySelector('table');
    if (table) {
      return table;
    }
    await sleep();
  }
  throw new TableCaptureError(
    'TABLE_NOT_FOUND',
    '未找到语雀表格视图，请刷新页面后重试'
  );
}

async function waitForLayout({ doc, sleep, now, timeoutMs = 10_000 }) {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    const layout = discoverTableLayout(doc);
    if (layout.columns.length > 0 && layout.rows.length > 0) {
      return layout;
    }
    await sleep();
  }
  throw new TableCaptureError(
    'TABLE_NOT_FOUND',
    '未找到语雀表格视图，请刷新页面后重试'
  );
}

function hasGeometryTableRoot(doc) {
  return [...(doc.querySelectorAll?.('table, [role="grid"]') ?? [])].some(
    (root) => typeof root.getBoundingClientRect === 'function'
  );
}

export async function captureStructuredTable({
  doc = document,
  locationHref = doc.location?.href,
  onProgress = () => {},
  now = Date.now,
  sleep = () => defaultRenderSleep(doc),
  deadlineMs = 120_000
} = {}) {
  const inspection = inspectStructuredPage(doc);
  if (!inspection.structured) {
    throw new TableCaptureError(
      'NOT_STRUCTURED',
      '当前页面不是可导出的语雀表格/看板'
    );
  }

  const initialBaseUrl = baseUrl(locationHref);
  const originalView = inspection.activeView;
  const originalTab = originalView ? findViewTab(doc, originalView) : undefined;
  const tableTab = findViewTab(doc, '表格视图');
  let scroller;
  let originalScrollTop;
  let scrollPositions = [];

  try {
    if (originalView !== '表格视图') {
      onProgress('正在切换到表格视图…');
      tableTab.click();
      await sleep();
    }

    const layout = hasGeometryTableRoot(doc)
      ? await waitForLayout({ doc, sleep, now })
      : null;
    const table = layout ? null : await waitForTable({ doc, sleep, now });
    const columns = layout ? layout.columns : extractTableColumns(table);
    if (columns.length === 0) {
      throw new TableCaptureError('EMPTY_COLUMNS', '未读取到表格字段');
    }

    if (layout) {
      scrollPositions = captureScrollPositions(layout, doc.defaultView);
      scroller = scrollPositions.find(({ vertical }) => vertical)?.element;
      if (scrollPositions.length > 0) {
        for (const position of scrollPositions) {
          if (position.vertical) {
            position.element.scrollTop = 0;
          }
          if (position.horizontal) {
            position.element.scrollLeft = 0;
          }
        }
        await sleep();
      }
    } else {
      scroller = findVerticalScroller(table, doc.defaultView);
      if (scroller) {
        originalScrollTop = scroller.scrollTop;
        scroller.scrollTop = 0;
        await sleep();
      }
    }

    const records = await collectVirtualRecords({
      columns,
      sample: () => {
        if (baseUrl(doc.location?.href ?? locationHref) !== initialBaseUrl) {
          throw new TableCaptureError(
            'PAGE_CHANGED',
            '采集期间页面已切换，请回到原表格后重试'
          );
        }
        if (layout) {
          const currentLayout = discoverTableLayout(doc);
          if (
            currentLayout.columns.length === 0 ||
            currentLayout.rows.length === 0
          ) {
            return [];
          }
          const currentColumns = alignLayoutColumns(
            currentLayout.columns,
            columns
          );
          return sampleLayoutRecords(currentLayout, currentColumns);
        }
        return extractRenderedRecords(table, columns);
      },
      advance: async () => {
        if (layout) {
          const horizontalPositions = scrollPositions.filter(
            ({ horizontal }) => horizontal
          );
          const horizontalPending = horizontalPositions.some(
            ({ element }) => !atHorizontalEnd(element)
          );
          if (horizontalPending) {
            const reference = horizontalPositions[0]?.element;
            if (!reference) {
              return;
            }
            const step = Math.max(1, Math.floor(reference.clientWidth * 0.8));
            for (const { element } of horizontalPositions) {
              element.scrollLeft = Math.min(
                element.scrollWidth - element.clientWidth,
                element.scrollLeft + step
              );
            }
            return;
          }
        }
        if (!scroller) {
          return;
        }
        const step = Math.max(1, Math.floor(scroller.clientHeight * 0.8));
        const verticalPositions = layout
          ? scrollPositions.filter(({ vertical }) => vertical)
          : [{ element: scroller }];
        for (const { element } of verticalPositions) {
          element.scrollTop = Math.min(
            element.scrollHeight - element.clientHeight,
            element.scrollTop + step
          );
        }
        if (layout) {
          for (const { element } of scrollPositions) {
            if (element.horizontal) {
              element.scrollLeft = 0;
            }
          }
        }
      },
      isAtBottom: () => {
        if (layout) {
          const verticalPositions = scrollPositions.filter(
            ({ vertical }) => vertical
          );
          const horizontalPositions = scrollPositions.filter(
            ({ horizontal }) => horizontal
          );
          return (
            verticalPositions.every(({ element }) => atVerticalEnd(element)) &&
            horizontalPositions.every(({ element }) => atHorizontalEnd(element))
          );
        }
        return !scroller || atVerticalEnd(scroller);
      },
      sleep,
      now,
      deadlineMs,
      onProgress: (count) => onProgress(`正在采集记录：${count} 条`)
    });

    if (records.length === 0) {
      throw new TableCaptureError(
        'NO_RECORDS',
        '未读取到可导出的表格记录',
        { diagnostic: layout?.diagnostic ?? describeDocumentShape(doc) }
      );
    }

    return {
      title: normalizeText(doc.title) || '语雀表格',
      sourceUrl: initialBaseUrl,
      viewName: '表格视图',
      filtersActive: pageHasFilters(doc),
      columns,
      records
    };
  } finally {
    if (scrollPositions.length > 0) {
      restoreScrollPositions(scrollPositions);
    } else if (scroller && originalScrollTop !== undefined) {
      scroller.scrollTop = originalScrollTop;
    }
    if (originalView && originalView !== '表格视图' && originalTab) {
      try {
        originalTab.click();
      } catch {
        onProgress('表格已采集，但原视图未能自动恢复');
      }
    }
  }
}
