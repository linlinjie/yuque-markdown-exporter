import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

import {
  convertStructuredDoc,
  isStructuredDoc
} from '../lib/sheet-parse.js';

function inflate(bytes) {
  return inflateSync(Buffer.from(bytes)).toString('utf8');
}

function compressJson(value) {
  return deflateSync(JSON.stringify(value)).toString('latin1');
}

const source = {
  title: '需求跟踪表',
  sourceUrl: 'https://zhyk.yuque.com/oa6mm8/layc61/ce8pdoqneh90ybu1'
};

test('识别语雀表格和数据表文档', () => {
  assert.equal(isStructuredDoc({ type: 'Sheet', format: 'lakesheet' }), true);
  assert.equal(isStructuredDoc({ type: 'Table', format: 'laketable' }), true);
  assert.equal(isStructuredDoc({ format: 'lakesheet' }), true);
  assert.equal(isStructuredDoc({ type: 'Doc', format: 'lake' }), false);
});

test('普通文档的 lake HTML 不会被当成表格', () => {
  assert.equal(
    isStructuredDoc({
      type: 'Doc',
      format: 'lake',
      content: '<p>hello</p>',
      body: '<p>hello</p>'
    }),
    false
  );
});

test('把 Open API 的 body_sheet 二维表转成记录', async () => {
  const table = await convertStructuredDoc(
    {
      type: 'Sheet',
      format: 'lakesheet',
      title: '需求跟踪表',
      body_sheet: JSON.stringify({
        version: '1.0',
        data: [
          {
            name: 'Sheet1',
            table: [
              ['事项', '状态', '负责人'],
              ['事项 A', '进行中', '李晓萌'],
              ['事项 B', '', '']
            ]
          }
        ]
      })
    },
    source
  );

  assert.deepEqual(
    table.columns.map(({ name }) => name),
    ['事项', '状态', '负责人']
  );
  assert.deepEqual(table.records.map(({ values }) => values), [
    { 'column-0': '事项 A', 'column-1': '进行中', 'column-2': '李晓萌' },
    { 'column-0': '事项 B', 'column-1': '', 'column-2': '' }
  ]);
  assert.equal(table.exportScope, '语雀表格（完整工作表）');
  assert.equal(table.viewName, '表格');
});

test('把压缩 Lakesheet 网格转成记录', async () => {
  const sheet = {
    name: '工作表1',
    data: {
      0: { 0: { v: '事项' }, 1: { v: '状态' } },
      1: { 0: { v: '事项 A' }, 1: { v: '进行中' } },
      2: { 0: { v: '事项 B' }, 1: { v: { text: '方案', url: 'https://example.test/doc' } } }
    }
  };
  const table = await convertStructuredDoc(
    {
      type: 'Sheet',
      format: 'lakesheet',
      title: '需求跟踪表',
      content: JSON.stringify({ sheet: compressJson(sheet) })
    },
    { ...source, inflate }
  );

  assert.deepEqual(table.columns.map(({ name }) => name), ['事项', '状态']);
  assert.deepEqual(table.records[0].values, {
    'column-0': '事项 A',
    'column-1': '进行中'
  });
  assert.deepEqual(table.records[1].values['column-1'], {
    text: '方案',
    href: 'https://example.test/doc'
  });
});

test('语雀 Excel 网格解析下拉、链接和公式显示值', async () => {
  const sheet = {
    name: '用工',
    data: {
      0: {
        0: {
          s: 0,
          v: {
            class: 'select',
            options: [{ value: '业务板块' }],
            value: ['业务板块']
          }
        },
        1: { v: '工程arch链接' }
      },
      1: {
        0: { v: '员工服务' },
        1: {
          s: 3,
          t: 0,
          v: {
            class: 'link',
            text: 'zhonghe-kylin',
            url: 'https://arch.shebao.net/#/pm/project-home/project-info/zhonghe-kylin'
          }
        }
      },
      2: {
        0: {
          v: {
            class: 'formula',
            formula: 'SUM(D5:D8)',
            value: 10,
            error: false
          }
        },
        1: { v: '' }
      }
    }
  };
  const table = await convertStructuredDoc(
    {
      type: 'Sheet',
      format: 'lakesheet',
      title: '系统清单',
      body: JSON.stringify({
        format: 'lakesheet',
        version: '3.5.5',
        larkJson: true,
        sheet: compressJson(sheet)
      })
    },
    { ...source, inflate, title: '系统清单' }
  );

  assert.deepEqual(table.columns.map(({ name }) => name), [
    '业务板块',
    '工程arch链接'
  ]);
  assert.deepEqual(table.records[0].values, {
    'column-0': '员工服务',
    'column-1': {
      text: 'zhonghe-kylin',
      href: 'https://arch.shebao.net/#/pm/project-home/project-info/zhonghe-kylin'
    }
  });
  assert.equal(table.records[1].values['column-0'], 10);
});

test('把数据表 columns/records 转成记录并解析选项', async () => {
  const table = await convertStructuredDoc(
    {
      type: 'Table',
      format: 'laketable',
      title: '早会看板',
      body_table: JSON.stringify({
        format: 'laketable',
        type: 'Table',
        sheet: [
          {
            columns: [
              { id: 'c1', name: '事项', type: 'text' },
              {
                id: 'c2',
                name: '状态',
                type: 'select',
                options: [{ id: 's1', value: '进行中' }]
              },
              {
                id: 'c3',
                name: '标签',
                type: 'multiSelect',
                options: [
                  { id: 't1', value: 'E端' },
                  { id: 't2', value: '考勤' }
                ]
              }
            ],
            records: [
              {
                data: {
                  c1: { value: '事项 A' },
                  c2: { value: 's1' },
                  c3: { value: ['t1', 't2'] }
                }
              }
            ]
          }
        ]
      })
    },
    { title: '早会看板', sourceUrl: 'https://team.yuque.com/a/b/c' }
  );

  assert.equal(table.viewName, '表格视图');
  assert.deepEqual(table.records[0].values, {
    'column-0': '事项 A',
    'column-1': '进行中',
    'column-2': ['E端', '考勤']
  });
});

test('多个工作表都保留下来', async () => {
  const table = await convertStructuredDoc(
    {
      type: 'Sheet',
      format: 'lakesheet',
      body_sheet: JSON.stringify({
        data: [
          { name: '需求', table: [['事项'], ['A']] },
          { name: '进度', table: [['状态'], ['进行中']] }
        ]
      })
    },
    source
  );

  assert.equal(table.sheets.length, 2);
  assert.deepEqual(
    table.sheets.map((sheet) => sheet.columns[0].name),
    ['事项', '状态']
  );
});

test('没有可用表格数据时失败', async () => {
  await assert.rejects(
    convertStructuredDoc(
      { type: 'Sheet', format: 'lakesheet', body_sheet: '{}' },
      source
    ),
    (error) => error.code === 'EMPTY_SHEET'
  );
});
