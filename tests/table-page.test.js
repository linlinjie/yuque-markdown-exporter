import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureStructuredTable,
  cellValueForColumn,
  clusterRows,
  discoverTableLayout,
  extractRenderedRecords,
  extractTableColumns,
  inspectStructuredPage,
  normalizeRenderedRow,
  sampleLayoutRecords
} from '../lib/table-page.js';

function fakeTab(textContent, selected = false) {
  return {
    textContent,
    getAttribute(name) {
      return name === 'aria-selected' && selected ? 'true' : null;
    },
    matches(selector) {
      return selected && selector === '[aria-selected="true"]';
    }
  };
}

function fakeDocument(tabs) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '[role="tab"]');
      return tabs;
    }
  };
}

function fakeCell(text, options = {}) {
  const anchors = options.href
    ? [
        {
          textContent: options.linkText ?? text,
          href: options.href,
          getAttribute(name) {
            return name === 'href' ? options.href : null;
          }
        }
      ]
    : [];
  const badges = (options.badges ?? []).map((badge) => ({
    innerText: badge,
    textContent: badge
  }));

  return {
    innerText: text,
    textContent: text,
    children: options.children ?? [],
    querySelectorAll(selector) {
      if (selector === 'a[href]') {
        return anchors;
      }
      if (selector.includes('[role="listitem"]')) {
        return badges;
      }
      return [];
    }
  };
}

function fakeButton(children, { tagName = 'BUTTON', role = null } = {}) {
  return {
    tagName,
    children,
    innerText: children.map((child) => child.innerText).join(' '),
    textContent: children.map((child) => child.textContent).join(' '),
    getAttribute(name) {
      return name === 'role' ? role : null;
    }
  };
}

function fakeRow(buttons, children = []) {
  return {
    children,
    querySelectorAll(selector) {
      if (selector === 'button') {
        return buttons.filter((button) => button.tagName === 'BUTTON');
      }
      if (selector === 'button, [role="button"]') {
        return buttons.filter(
          (button) =>
            button.tagName === 'BUTTON' ||
            button.getAttribute('role') === 'button'
        );
      }
      assert.fail(`unexpected row selector: ${selector}`);
    }
  };
}

function fakeTable(rows) {
  return {
    querySelectorAll(selector) {
      return selector === '[role="row"], tr' ? rows : [];
    }
  };
}

function fakeRect(left, top, width, height = 20) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
}

function fakeLayoutCell(text, rect, { role = 'cell' } = {}) {
  return {
    tagName: role === 'columnheader' ? 'TH' : 'TD',
    innerText: text,
    textContent: text,
    children: [],
    getAttribute(name) {
      return name === 'role' ? role : null;
    },
    getBoundingClientRect() {
      return fakeRect(...rect);
    },
    querySelectorAll() {
      return [];
    }
  };
}

function fakeLayoutRow(top, cells, { header = false, rowIndex } = {}) {
  const row = {
    tagName: 'TR',
    children: cells,
    getAttribute(name) {
      if (name === 'role') {
        return 'row';
      }
      if (name === 'aria-rowindex' && rowIndex !== undefined) {
        return String(rowIndex);
      }
      return null;
    },
    getBoundingClientRect() {
      const rects = cells.map((cell) => cell.getBoundingClientRect());
      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return fakeRect(left, top, right - left, bottom - top);
    },
    querySelectorAll(selector) {
      if (
        selector === '[role="gridcell"], [role="cell"], td, th' ||
        selector === '[role="columnheader"], th'
      ) {
        return cells;
      }
      return [];
    },
    isHeader: header
  };
  return row;
}

function fakePane({ left, top, width, rows }) {
  return {
    tagName: 'TABLE',
    getBoundingClientRect() {
      return fakeRect(left, top, width, 300);
    },
    querySelectorAll(selector) {
      return selector === '[role="row"], tr' ? rows : [];
    }
  };
}

function fakeGridDocument(panes) {
  return {
    defaultView: { innerWidth: 1200, innerHeight: 900 },
    querySelectorAll(selector) {
      if (selector === 'table, [role="grid"]') {
        return panes;
      }
      if (selector === 'table') {
        return panes;
      }
      return [];
    }
  };
}

function fakeRecordSource(text, left, top, rowIndex) {
  const cell = fakeLayoutCell(text, [left, top, 120]);
  return {
    left,
    top,
    bottom: top + 20,
    source: {
      getAttribute(name) {
        return name === 'aria-rowindex' && rowIndex !== undefined
          ? String(rowIndex)
          : null;
      }
    },
    cells: [cell]
  };
}

function fakeCaptureDocument(table, initialView = '表格视图') {
  let activeView = initialView;
  const clicks = [];
  const tabs = ['看板视图', '表格视图'].map((label) => ({
    textContent: label,
    getAttribute(name) {
      return name === 'aria-selected' && activeView === label ? 'true' : null;
    },
    matches(selector) {
      return selector === '[aria-selected="true"]' && activeView === label;
    },
    click() {
      activeView = label;
      clicks.push(label);
    }
  }));

  return {
    title: '早会看板',
    location: { href: 'https://team.yuque.com/a/b/c#view:table' },
    defaultView: {
      getComputedStyle() {
        return { overflowY: 'visible' };
      },
      requestAnimationFrame(callback) {
        callback();
      }
    },
    clicks,
    get activeView() {
      return activeView;
    },
    querySelector(selector) {
      return selector === 'table' ? table : null;
    },
    querySelectorAll(selector) {
      if (selector === '[role="tab"]') {
        return tabs;
      }
      if (selector === 'table') {
        return [table];
      }
      if (selector === 'button') {
        return [{ innerText: '1个筛选', textContent: '1个筛选' }];
      }
      return [];
    }
  };
}

function fakeMultiPaneCaptureDocument(
  panes,
  initialView = '看板视图',
  getComputedStyle = () => ({ overflowY: 'visible', overflowX: 'visible' })
) {
  let activeView = initialView;
  const clicks = [];
  const tabs = ['看板视图', '表格视图'].map((label) => ({
    textContent: label,
    getAttribute(name) {
      return name === 'aria-selected' && activeView === label ? 'true' : null;
    },
    matches(selector) {
      return selector === '[aria-selected="true"]' && activeView === label;
    },
    click() {
      activeView = label;
      clicks.push(label);
    }
  }));

  return {
    title: '早会看板',
    location: { href: 'https://team.yuque.com/a/b/c#view:board' },
    defaultView: {
      innerWidth: 1200,
      innerHeight: 900,
      getComputedStyle,
      requestAnimationFrame(callback) {
        callback();
      }
    },
    clicks,
    get activeView() {
      return activeView;
    },
    querySelectorAll(selector) {
      if (selector === '[role="tab"]') {
        return tabs;
      }
      if (selector === 'table, [role="grid"]' || selector === 'table') {
        return panes;
      }
      if (selector === 'button') {
        return [];
      }
      return [];
    }
  };
}

test('通过页面视图标签识别结构化表格', () => {
  const doc = fakeDocument([
    fakeTab('看板视图', false),
    fakeTab('表格视图 remove', true)
  ]);

  assert.deepEqual(inspectStructuredPage(doc), {
    structured: true,
    activeView: '表格视图',
    hasTableView: true
  });
});

test('普通语雀文档不被识别为结构化页面', () => {
  assert.deepEqual(inspectStructuredPage(fakeDocument([])), {
    structured: false,
    activeView: null,
    hasTableView: false
  });
});

test('缺少表格视图时不进入当前版本的结构化导出', () => {
  assert.deepEqual(
    inspectStructuredPage(fakeDocument([fakeTab('看板视图', true)])),
    {
      structured: false,
      activeView: '看板视图',
      hasTableView: false
    }
  );
});

test('没有稳定行号的分组和统计行不会被当作记录', () => {
  assert.equal(
    normalizeRenderedRow(
      {
        rowIndex: '',
        primaryText: '人事合同',
        cells: [fakeCell('人事合同')]
      },
      [{ id: 'subject', name: '事项' }]
    ),
    null
  );
});

test('记录按字段位置保留空值并生成稳定键', () => {
  assert.deepEqual(
    normalizeRenderedRow(
      {
        rowIndex: '12',
        primaryText: '事项 A',
        cells: [fakeCell('事项 A'), fakeCell(''), fakeCell('2026-08-19')]
      },
      [
        { id: 'subject', name: '事项' },
        { id: 'owner', name: '负责人' },
        { id: 'date', name: '日期' }
      ]
    ),
    {
      key: '12:事项 A',
      values: {
        subject: '事项 A',
        owner: '',
        date: '2026-08-19'
      }
    }
  );
});

test('单元格链接保留显示文本和绝对地址', () => {
  const record = normalizeRenderedRow(
    {
      rowIndex: 3,
      primaryText: '方案',
      cells: [
        fakeCell('方案文档', {
          href: 'https://team.yuque.com/a/b/c',
          linkText: '方案文档'
        })
      ]
    },
    [{ id: 'doc', name: '文档' }]
  );

  assert.deepEqual(record.values.doc, {
    text: '方案文档',
    href: 'https://team.yuque.com/a/b/c'
  });
});

test('多选标签按页面顺序保存为数组', () => {
  const record = normalizeRenderedRow(
    {
      rowIndex: 4,
      primaryText: '事项',
      cells: [fakeCell('E端 考勤', { badges: ['E端', '考勤'] })]
    },
    [{ id: 'tags', name: '标签' }]
  );

  assert.deepEqual(record.values.tags, ['E端', '考勤']);
});

test('从表头按钮生成稳定且去重的字段 ID', () => {
  const table = fakeTable([
    fakeRow([
      fakeButton([fakeCell('事项')]),
      fakeButton([fakeCell('状态')]),
      fakeButton([fakeCell('状态')])
    ])
  ]);

  assert.deepEqual(extractTableColumns(table), [
    { id: 'column-0', name: '事项' },
    { id: 'column-1', name: '状态' },
    { id: 'column-2', name: '状态 (2)' }
  ]);
});

test('从 role=button 的自定义表头控件提取字段', () => {
  const table = fakeTable([
    fakeRow([
      fakeButton([fakeCell('事项')], { tagName: 'DIV', role: 'button' }),
      fakeButton([fakeCell('状态')], { tagName: 'DIV', role: 'button' })
    ])
  ]);

  assert.deepEqual(extractTableColumns(table), [
    { id: 'column-0', name: '事项' },
    { id: 'column-1', name: '状态' }
  ]);
});

test('只从含数字索引的记录按钮提取当前渲染行', () => {
  const header = fakeRow([
    fakeButton([fakeCell('事项')]),
    fakeButton([fakeCell('状态')])
  ]);
  const group = fakeRow([fakeButton([fakeCell('人事合同')])]);
  const data = fakeRow([
    fakeButton([fakeCell('7'), fakeCell('事项 A'), fakeCell('进行中')])
  ]);
  const table = fakeTable([header, group, data]);
  const columns = [
    { id: 'column-0', name: '事项' },
    { id: 'column-1', name: '状态' }
  ];

  assert.deepEqual(extractRenderedRecords(table, columns), [
    {
      key: '7:事项 A',
      values: {
        'column-0': '事项 A',
        'column-1': '进行中'
      }
    }
  ]);
});

test('从 role=button 的自定义记录控件提取单元格', () => {
  const data = fakeRow([
    fakeButton(
      [fakeCell('7'), fakeCell('事项 A'), fakeCell('进行中')],
      { tagName: 'DIV', role: 'button' }
    )
  ]);
  const table = fakeTable([data]);
  const columns = [
    { id: 'column-0', name: '事项' },
    { id: 'column-1', name: '状态' }
  ];

  assert.deepEqual(extractRenderedRecords(table, columns), [
    {
      key: '7:事项 A',
      values: {
        'column-0': '事项 A',
        'column-1': '进行中'
      }
    }
  ]);
});

test('从带前置选择列和行号的标准表格行提取单元格', () => {
  const data = fakeRow([], [
    fakeCell(''),
    fakeCell('7'),
    fakeCell('事项 A'),
    fakeCell('进行中')
  ]);
  const table = fakeTable([data]);
  const columns = [
    { id: 'column-0', name: '事项' },
    { id: 'column-1', name: '状态' }
  ];

  assert.deepEqual(extractRenderedRecords(table, columns), [
    {
      key: '7:事项 A',
      values: {
        'column-0': '事项 A',
        'column-1': '进行中'
      }
    }
  ]);
});

test('从看板临时切到表格采集并恢复原视图', async () => {
  const table = fakeTable([
    fakeRow([
      fakeButton([fakeCell('事项')]),
      fakeButton([fakeCell('状态')])
    ]),
    fakeRow([
      fakeButton([fakeCell('1'), fakeCell('事项 A'), fakeCell('进行中')])
    ])
  ]);
  const doc = fakeCaptureDocument(table, '看板视图');
  const progress = [];

  const result = await captureStructuredTable({
    doc,
    locationHref: doc.location.href,
    sleep: async () => {},
    now: () => 0,
    onProgress: (message) => progress.push(message)
  });

  assert.deepEqual(result, {
    title: '早会看板',
    sourceUrl: 'https://team.yuque.com/a/b/c',
    viewName: '表格视图',
    filtersActive: true,
    columns: [
      { id: 'column-0', name: '事项' },
      { id: 'column-1', name: '状态' }
    ],
    records: [
      {
        key: '1:事项 A',
        values: { 'column-0': '事项 A', 'column-1': '进行中' }
      }
    ]
  });
  assert.deepEqual(doc.clicks, ['表格视图', '看板视图']);
  assert.equal(doc.activeView, '看板视图');
  assert.ok(progress.some((message) => message.includes('1 条')));
});

test('结构化采集使用多窗格布局并恢复原视图', async () => {
  const panes = [
    fakePane({
      left: 0,
      top: 0,
      width: 280,
      rows: [
        fakeLayoutRow(0, [
          fakeLayoutCell('事项', [0, 0, 280], { role: 'columnheader' })
        ], { header: true }),
        fakeLayoutRow(10, [fakeLayoutCell('事项 A', [0, 10, 280])], {
          rowIndex: 0
        })
      ]
    }),
    fakePane({
      left: 280,
      top: 0,
      width: 140,
      rows: [
        fakeLayoutRow(0, [
          fakeLayoutCell('状态', [280, 0, 140], { role: 'columnheader' })
        ], { header: true }),
        fakeLayoutRow(11, [fakeLayoutCell('进行中', [280, 11, 140])], {
          rowIndex: 0
        })
      ]
    }),
    fakePane({
      left: 420,
      top: 0,
      width: 180,
      rows: [
        fakeLayoutRow(0, [
          fakeLayoutCell('负责人', [420, 0, 180], { role: 'columnheader' })
        ], { header: true }),
        fakeLayoutRow(9, [fakeLayoutCell('李晓萌', [420, 9, 180])], {
          rowIndex: 0
        })
      ]
    })
  ];
  const doc = fakeMultiPaneCaptureDocument(panes);

  const result = await captureStructuredTable({
    doc,
    locationHref: doc.location.href,
    sleep: async () => {},
    now: () => 0
  });

  assert.deepEqual(result.columns.map(({ name }) => name), [
    '事项',
    '状态',
    '负责人'
  ]);
  assert.deepEqual(result.records, [
    {
      key: 'row-0',
      values: {
        'column-0': '事项 A',
        'column-1': '进行中',
        'column-2': '李晓萌'
      }
    }
  ]);
  assert.deepEqual(doc.clicks, ['表格视图', '看板视图']);
  assert.equal(doc.activeView, '看板视图');
});

test('结构化采集遍历横向分段并恢复横向滚动位置', async () => {
  const pane = fakePane({
    left: 0,
    top: 0,
    width: 280,
    rows: [
      fakeLayoutRow(0, [
        fakeLayoutCell('事项', [0, 0, 280], { role: 'columnheader' })
      ], { header: true }),
      fakeLayoutRow(10, [fakeLayoutCell('事项 A', [0, 10, 280])], {
        rowIndex: 0
      })
    ]
  });
  const horizontalScroller = {
    scrollLeft: 150,
    scrollTop: 0,
    scrollWidth: 1000,
    clientWidth: 400,
    scrollHeight: 300,
    clientHeight: 300,
    horizontal: true,
    parentElement: null,
    querySelectorAll() {
      return [];
    }
  };
  pane.parentElement = horizontalScroller;
  const doc = fakeMultiPaneCaptureDocument(
    [pane],
    '表格视图',
    (element) =>
      element?.horizontal
        ? { overflowY: 'visible', overflowX: 'auto' }
        : { overflowY: 'visible', overflowX: 'visible' }
  );

  const result = await captureStructuredTable({
    doc,
    locationHref: doc.location.href,
    sleep: async () => {},
    now: () => 0
  });

  assert.equal(result.records.length, 1);
  assert.equal(horizontalScroller.scrollLeft, 150);
});

test('表头为空时拒绝返回不可验证的数据', async () => {
  const doc = fakeCaptureDocument(fakeTable([]));

  await assert.rejects(
    captureStructuredTable({
      doc,
      locationHref: doc.location.href,
      sleep: async () => {},
      now: () => 0
    }),
    (error) => error.code === 'EMPTY_COLUMNS'
  );
});

test('无记录时错误正文简短且诊断独立传递', async () => {
  const table = fakeTable([
    fakeRow([
      fakeButton([fakeCell('事项')]),
      fakeButton([fakeCell('状态')])
    ]),
    fakeRow([], [fakeCell(''), fakeCell('未知结构')])
  ]);
  const doc = fakeCaptureDocument(table);

  await assert.rejects(
    captureStructuredTable({
      doc,
      locationHref: doc.location.href,
      sleep: async () => {},
      now: () => 0
    }),
    (error) =>
      error.code === 'NO_RECORDS' &&
      error.message === '未读取到可导出的表格记录' &&
      typeof error.details?.diagnostic === 'string' &&
      error.details.diagnostic.includes('rows=2')
  );
});

test('独立窗格中同一纵向位置的行合并为一个行带', () => {
  const layout = discoverTableLayout(
    fakeGridDocument([
      fakePane({
        left: 0,
        top: 0,
        width: 300,
        rows: [
          fakeLayoutRow(0, [
            fakeLayoutCell('事项', [0, 0, 300], { role: 'columnheader' })
          ], { header: true }),
          fakeLayoutRow(10, [fakeLayoutCell('事项 A', [0, 10, 300])])
        ]
      }),
      fakePane({
        left: 300,
        top: 0,
        width: 280,
        rows: [
          fakeLayoutRow(0, [
            fakeLayoutCell('状态', [300, 0, 280], { role: 'columnheader' })
          ], { header: true }),
          fakeLayoutRow(11, [fakeLayoutCell('进行中', [300, 11, 280])])
        ]
      })
    ])
  );

  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].sources.length, 2);
  assert.deepEqual(layout.columns.map(({ name }) => name), ['事项', '状态']);
});

test('行带允许两个像素的窗格偏差但拒绝跨行合并', () => {
  assert.equal(
    clusterRows([
      { top: 10, bottom: 40, source: {} },
      { top: 12, bottom: 42, source: {} }
    ], 3).length,
    1
  );
  assert.equal(
    clusterRows([
      { top: 10, bottom: 30, source: {} },
      { top: 34, bottom: 54, source: {} }
    ], 3).length,
    2
  );
});

test('只出现在单个窗格的分组行不会被当作记录', () => {
  const layout = discoverTableLayout(
    fakeGridDocument([
      fakePane({
        left: 0,
        top: 0,
        width: 300,
        rows: [
          fakeLayoutRow(0, [
            fakeLayoutCell('事项', [0, 0, 300], { role: 'columnheader' })
          ], { header: true }),
          fakeLayoutRow(10, [fakeLayoutCell('人事合同', [0, 10, 300])]),
          fakeLayoutRow(30, [fakeLayoutCell('事项 A', [0, 30, 300])])
        ]
      }),
      fakePane({
        left: 300,
        top: 0,
        width: 280,
        rows: [
          fakeLayoutRow(0, [
            fakeLayoutCell('状态', [300, 0, 280], { role: 'columnheader' })
          ], { header: true }),
          fakeLayoutRow(31, [fakeLayoutCell('进行中', [300, 31, 280])])
        ]
      })
    ])
  );

  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].sources.length, 2);
});

test('按字段横向区间选择行带中的单元格', () => {
  const cell = fakeLayoutCell('进行中', [300, 11, 280]);
  const rowBand = {
    top: 10,
    bottom: 40,
    sources: [{ top: 11, bottom: 31, cells: [cell] }]
  };

  assert.equal(
    cellValueForColumn(rowBand, { left: 300, right: 580 }),
    cell
  );
});

test('固定列和独立字段窗格按视觉行合并完整记录', () => {
  const layout = discoverTableLayout(
    fakeGridDocument([
      fakePane({
        left: 0,
        top: 0,
        width: 280,
        rows: [
          fakeLayoutRow(0, [
            fakeLayoutCell('事项', [0, 0, 280], { role: 'columnheader' })
          ], { header: true }),
          fakeLayoutRow(10, [fakeLayoutCell('事项 A', [0, 10, 280])], {
            rowIndex: 0
          })
        ]
      }),
      fakePane({
        left: 280,
        top: 0,
        width: 140,
        rows: [
          fakeLayoutRow(0, [
            fakeLayoutCell('状态', [280, 0, 140], { role: 'columnheader' })
          ], { header: true }),
          fakeLayoutRow(11, [fakeLayoutCell('进行中', [280, 11, 140])], {
            rowIndex: 0
          })
        ]
      }),
      fakePane({
        left: 420,
        top: 0,
        width: 180,
        rows: [
          fakeLayoutRow(0, [
            fakeLayoutCell('负责人', [420, 0, 180], { role: 'columnheader' })
          ], { header: true }),
          fakeLayoutRow(9, [fakeLayoutCell('李晓萌', [420, 9, 180])], {
            rowIndex: 0
          })
        ]
      })
    ])
  );

  assert.deepEqual(sampleLayoutRecords(layout, layout.columns), [
    {
      key: 'row-0',
      values: {
        'column-0': '事项 A',
        'column-1': '进行中',
        'column-2': '李晓萌'
      }
    }
  ]);
});

test('空字段保留为空字符串而不左移后续字段', () => {
  const layout = {
    diagnostic: 'tables=2',
    rows: [
      {
        top: 10,
        bottom: 30,
        sources: [
          fakeRecordSource('事项 A', 0, 10, 0),
          fakeRecordSource('', 120, 11, 0)
        ]
      }
    ]
  };
  const columns = [
    { id: 'column-0', name: '事项', left: 0, right: 120 },
    { id: 'column-1', name: '状态', left: 120, right: 240 }
  ];

  assert.deepEqual(sampleLayoutRecords(layout, columns), [
    {
      key: 'row-0',
      values: { 'column-0': '事项 A', 'column-1': '' }
    }
  ]);
});

test('重复主字段有稳定行号时保留为两条记录', () => {
  const layout = {
    diagnostic: 'tables=1',
    rows: [
      {
        top: 10,
        bottom: 30,
        sources: [fakeRecordSource('同名事项', 0, 10, 1)]
      },
      {
        top: 40,
        bottom: 60,
        sources: [fakeRecordSource('同名事项', 0, 40, 2)]
      }
    ]
  };
  const columns = [{ id: 'column-0', name: '事项', left: 0, right: 120 }];

  assert.deepEqual(
    sampleLayoutRecords(layout, columns).map(({ key }) => key),
    ['row-1', 'row-2']
  );
});

test('重复主字段没有稳定标识时安全失败', () => {
  const layout = {
    diagnostic: 'tables=1',
    rows: [
      {
        top: 10,
        bottom: 30,
        sources: [fakeRecordSource('同名事项', 0, 10)]
      },
      {
        top: 40,
        bottom: 60,
        sources: [fakeRecordSource('同名事项', 0, 40)]
      }
    ]
  };

  assert.throws(
    () => sampleLayoutRecords(layout, [
      { id: 'column-0', name: '事项', left: 0, right: 120 }
    ]),
    (error) => error.code === 'UNSTABLE_RECORD_ID'
  );
});
