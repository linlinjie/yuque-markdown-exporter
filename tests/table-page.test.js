import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureStructuredTable,
  extractRenderedRecords,
  extractTableColumns,
  inspectStructuredPage,
  normalizeRenderedRow
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

function fakeButton(children) {
  return {
    children,
    innerText: children.map((child) => child.innerText).join(' '),
    textContent: children.map((child) => child.textContent).join(' ')
  };
}

function fakeRow(buttons) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, 'button');
      return buttons;
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
      if (selector === 'button') {
        return [{ innerText: '1个筛选', textContent: '1个筛选' }];
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
