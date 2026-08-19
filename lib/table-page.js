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

function buttonHasRecordIndex(button) {
  return /^\d+$/.test(normalizeText(directChildren(button)[0]?.innerText));
}

export function extractTableColumns(table) {
  const headerRow = tableRows(table).find((row) => {
    const buttons = [...row.querySelectorAll('button')];
    return buttons.length >= 2 && !buttons.some(buttonHasRecordIndex);
  });
  if (!headerRow) {
    return [];
  }

  const usedNames = new Map();
  return [...headerRow.querySelectorAll('button')]
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
    const recordButton = [...row.querySelectorAll('button')].find(
      buttonHasRecordIndex
    );
    if (!recordButton) {
      continue;
    }

    const children = directChildren(recordButton);
    const cells = children.slice(1, columns.length + 1);
    const record = normalizeRenderedRow(
      {
        rowIndex: normalizeText(children[0]?.innerText),
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

  try {
    if (originalView !== '表格视图') {
      onProgress('正在切换到表格视图…');
      tableTab.click();
      await sleep();
    }

    const table = await waitForTable({ doc, sleep, now });
    const columns = extractTableColumns(table);
    if (columns.length === 0) {
      throw new TableCaptureError('EMPTY_COLUMNS', '未读取到表格字段');
    }

    scroller = findVerticalScroller(table, doc.defaultView);
    if (scroller) {
      originalScrollTop = scroller.scrollTop;
      scroller.scrollTop = 0;
      await sleep();
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
        return extractRenderedRecords(table, columns);
      },
      advance: async () => {
        if (!scroller) {
          return;
        }
        const step = Math.max(1, Math.floor(scroller.clientHeight * 0.8));
        scroller.scrollTop = Math.min(
          scroller.scrollHeight - scroller.clientHeight,
          scroller.scrollTop + step
        );
      },
      isAtBottom: () =>
        !scroller ||
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
      sleep,
      now,
      deadlineMs,
      onProgress: (count) => onProgress(`正在采集记录：${count} 条`)
    });

    if (records.length === 0) {
      throw new TableCaptureError('NO_RECORDS', '未读取到可导出的表格记录');
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
    if (scroller && originalScrollTop !== undefined) {
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
