import test from 'node:test';
import assert from 'node:assert/strict';

import { tableToCsv, tableToMarkdown } from '../lib/table-format.js';

test('按字段顺序生成带来源信息的 Markdown 表格', () => {
  assert.equal(
    tableToMarkdown({
      title: '早会表',
      sourceUrl: 'https://team.yuque.com/a/b/c',
      viewName: '表格视图',
      filtersActive: true,
      columns: [
        { id: 'subject', name: '事项' },
        { id: 'status', name: '状态' },
        { id: 'doc', name: '文档' }
      ],
      records: [
        {
          key: '1',
          values: {
            subject: 'A | B\n下一行',
            status: ['进行中', 'P0'],
            doc: { text: '方案', href: 'https://example.test/doc' }
          }
        }
      ]
    }),
    [
      '# 早会表',
      '',
      '> 来源：https://team.yuque.com/a/b/c',
      '> 导出范围：当前表格视图（保留筛选、分组和排序）',
      '',
      '| 事项 | 状态 | 文档 |',
      '| --- | --- | --- |',
      '| A \\| B<br>下一行 | 进行中、P0 | [方案](https://example.test/doc) |',
      ''
    ].join('\n')
  );
});

test('空字段保留所在列而不移动后续值', () => {
  const markdown = tableToMarkdown({
    title: '空字段',
    sourceUrl: 'https://team.yuque.com/a/b/c',
    viewName: '表格视图',
    filtersActive: false,
    columns: [
      { id: 'a', name: '第一列' },
      { id: 'b', name: '空列' },
      { id: 'c', name: '第三列' }
    ],
    records: [{ key: '1', values: { a: 'A', c: 'C' } }]
  });

  assert.match(markdown, /\| A \|  \| C \|/);
});

test('生成带 BOM 且符合 RFC 4180 转义规则的 CSV', () => {
  const csv = tableToCsv({
    title: '表',
    sourceUrl: 'https://team.yuque.com/a/b/c',
    viewName: '表格视图',
    filtersActive: false,
    columns: [
      { id: 'a', name: '事项' },
      { id: 'b', name: '标签' }
    ],
    records: [
      {
        key: '1',
        values: { a: '含,逗号和"引号"\n换行', b: ['A', 'B'] }
      }
    ]
  });

  assert.equal(
    csv,
    '\uFEFF事项,标签\r\n"含,逗号和""引号""\n换行",A；B\r\n'
  );
});

test('CSV 链接同时保留显示文本和地址', () => {
  const csv = tableToCsv({
    title: '表',
    sourceUrl: 'https://team.yuque.com/a/b/c',
    viewName: '表格视图',
    filtersActive: false,
    columns: [{ id: 'doc', name: '文档' }],
    records: [
      {
        key: '1',
        values: {
          doc: { text: '方案', href: 'https://example.test/doc' }
        }
      }
    ]
  });

  assert.equal(csv, '\uFEFF文档\r\n方案 <https://example.test/doc>\r\n');
});

test('自定义导出范围和多个工作表都会写入 Markdown', () => {
  const markdown = tableToMarkdown({
    title: '需求跟踪表',
    sourceUrl: 'https://zhyk.yuque.com/oa6mm8/layc61/ce8pdoqneh90ybu1',
    exportScope: '语雀表格（完整工作表）',
    sheets: [
      {
        name: '需求',
        columns: [{ id: 'column-0', name: '事项' }],
        records: [{ key: 'row-0', values: { 'column-0': 'A' } }]
      },
      {
        name: '进度',
        columns: [{ id: 'column-0', name: '状态' }],
        records: [{ key: 'row-0', values: { 'column-0': '进行中' } }]
      }
    ]
  });

  assert.match(markdown, /语雀表格（完整工作表）/);
  assert.match(markdown, /## 需求/);
  assert.match(markdown, /## 进度/);
  assert.match(markdown, /\| A \|/);
  assert.match(markdown, /\| 进行中 \|/);
});
