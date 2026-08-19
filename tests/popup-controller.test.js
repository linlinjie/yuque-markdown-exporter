import test from 'node:test';
import assert from 'node:assert/strict';

import { createPopupController } from '../lib/popup-controller.js';

function markdownResponse(markdown, status = 200) {
  return new Response(markdown, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}

function imageResponse(bytes, contentType = 'image/png') {
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': contentType }
  });
}

function createHarness({
  tab = {
    id: 42,
    url: 'https://team.yuque.com/org/repo/doc',
    title: '季度需求'
  },
  fetchImpl = async () => markdownResponse('# 需求'),
  permissionGranted = true,
  inspections = [
    { structured: false, activeView: null, hasTableView: false }
  ],
  capturedTable = {
    title: '季度需求',
    sourceUrl: 'https://team.yuque.com/org/repo/doc',
    viewName: '表格视图',
    filtersActive: true,
    columns: [
      { id: 'subject', name: '事项' },
      { id: 'status', name: '状态' }
    ],
    records: [
      {
        key: '1:事项 A',
        values: { subject: '事项 A', status: '进行中' }
      }
    ]
  },
  captureError
} = {}) {
  const state = {
    page: undefined,
    busy: [],
    statuses: [],
    permission: undefined,
    opened: [],
    copied: [],
    downloads: [],
    permissionRequests: [],
    inspectionCalls: [],
    captureCalls: [],
    previews: [],
    captureProgress: []
  };

  const view = {
    renderPage(page) {
      state.page = page;
    },
    setBusy(value) {
      state.busy.push(value);
    },
    showStatus(kind, message) {
      state.statuses.push({ kind, message });
    },
    showPermissionStep(origins) {
      state.permission = origins;
    },
    showCaptureProgress(message) {
      state.captureProgress.push(message);
    }
  };

  let inspectionIndex = 0;

  const browser = {
    async getActiveTab() {
      return tab;
    },
    async inspectStructuredPage(tabId) {
      state.inspectionCalls.push(tabId);
      const index = Math.min(inspectionIndex, inspections.length - 1);
      inspectionIndex += 1;
      return inspections[index];
    },
    async captureStructuredTable(tabId) {
      state.captureCalls.push(tabId);
      if (captureError) {
        throw captureError;
      }
      return capturedTable;
    },
    async openGeneratedMarkdown(preview) {
      state.previews.push(preview);
    },
    async openTab(url) {
      state.opened.push(url);
    },
    async copyText(text) {
      state.copied.push(text);
    },
    requestOrigins(origins) {
      state.permissionRequests.push(origins);
      return Promise.resolve(permissionGranted);
    },
    async downloadBlob(blob, filename) {
      state.downloads.push({ blob, filename });
    }
  };

  return {
    controller: createPopupController({ browser, view, fetchImpl }),
    state
  };
}

test('非语雀文档初始化为不可操作状态', async () => {
  const { controller, state } = createHarness({
    tab: { id: 42, url: 'https://example.com/page', title: '普通网页' }
  });

  await controller.initialize();

  assert.deepEqual(state.page, {
    supported: false,
    kind: 'unsupported',
    title: '普通网页',
    reason: '当前页面不是语雀页面'
  });
});

test('初始化时主动识别结构化表格并切换页面类型', async () => {
  const { controller, state } = createHarness({
    inspections: [
      {
        structured: true,
        activeView: '看板视图',
        hasTableView: true
      }
    ]
  });

  await controller.initialize();

  assert.deepEqual(state.page, {
    supported: true,
    kind: 'table',
    title: '季度需求',
    reason: undefined
  });
  assert.deepEqual(state.inspectionCalls, [42]);
});

test('Markdown 返回 404 后重新识别延迟渲染的结构化页面', async () => {
  const { controller, state } = createHarness({
    fetchImpl: async () => markdownResponse('Not Found', 404),
    inspections: [
      { structured: false, activeView: null, hasTableView: false },
      {
        structured: true,
        activeView: '表格视图',
        hasTableView: true
      }
    ]
  });
  await controller.initialize();

  await controller.copyMarkdown();

  assert.equal(state.page.kind, 'table');
  assert.deepEqual(state.inspectionCalls, [42, 42]);
  assert.equal(state.captureCalls.length, 1);
  assert.match(state.copied[0], /\| 事项 A \| 进行中 \|/);
});

test('结构化页面复制 Markdown 并复用当前弹窗内的采集结果', async () => {
  const { controller, state } = createHarness({
    inspections: [
      {
        structured: true,
        activeView: '表格视图',
        hasTableView: true
      }
    ]
  });
  await controller.initialize();

  await controller.copyMarkdown();
  await controller.copyMarkdown();

  assert.deepEqual(state.captureCalls, [42]);
  assert.equal(state.copied.length, 2);
  assert.equal(state.copied[0], state.copied[1]);
  assert.match(state.copied[0], /\| 事项 \| 状态 \|/);
});

test('结构化页面查看由本地生成的 Markdown', async () => {
  const { controller, state } = createHarness({
    inspections: [
      {
        structured: true,
        activeView: '看板视图',
        hasTableView: true
      }
    ]
  });
  await controller.initialize();

  await controller.viewMarkdown();

  assert.equal(state.opened.length, 0);
  assert.equal(state.previews[0].title, '季度需求');
  assert.match(state.previews[0].markdown, /^# 季度需求/m);
});

test('结构化页面下载 Markdown 文件', async () => {
  const { controller, state } = createHarness({
    inspections: [
      {
        structured: true,
        activeView: '表格视图',
        hasTableView: true
      }
    ]
  });
  await controller.initialize();

  await controller.startExport('markdown');

  assert.equal(state.downloads[0].filename, '季度需求.md');
  assert.match(await state.downloads[0].blob.text(), /\| 事项 A \| 进行中 \|/);
});

test('结构化页面下载带 BOM 的 CSV 文件', async () => {
  const { controller, state } = createHarness({
    inspections: [
      {
        structured: true,
        activeView: '表格视图',
        hasTableView: true
      }
    ]
  });
  await controller.initialize();

  await controller.startExport('csv');

  assert.equal(state.downloads[0].filename, '季度需求.csv');
  assert.equal(state.downloads[0].blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual(
    [...new Uint8Array(await state.downloads[0].blob.arrayBuffer()).slice(0, 3)],
    [0xef, 0xbb, 0xbf]
  );
});

test('结构化页面采集失败时不生成文件', async () => {
  const { controller, state } = createHarness({
    inspections: [
      {
        structured: true,
        activeView: '表格视图',
        hasTableView: true
      }
    ],
    captureError: new Error('未能到达表格底部')
  });
  await controller.initialize();

  await controller.startExport('markdown');

  assert.deepEqual(state.downloads, []);
  assert.equal(state.statuses.at(-1).kind, 'error');
  assert.match(state.statuses.at(-1).message, /未能到达表格底部/);
});

test('查看 Markdown 打开规范化后的新标签页', async () => {
  const { controller, state } = createHarness();
  await controller.initialize();

  await controller.viewMarkdown();

  assert.deepEqual(state.opened, [
    'https://team.yuque.com/org/repo/doc/markdown?plain=true&linebreak=false&anchor=false'
  ]);
});

test('复制 Markdown 后展示成功状态', async () => {
  const { controller, state } = createHarness();
  await controller.initialize();

  await controller.copyMarkdown();

  assert.deepEqual(state.copied, ['# 需求']);
  assert.deepEqual(state.statuses.at(-1), {
    kind: 'success',
    message: 'Markdown 已复制到剪贴板'
  });
  assert.equal(state.busy.at(-1), false);
});

test('保持原地址模式直接下载 Markdown', async () => {
  const { controller, state } = createHarness();
  await controller.initialize();

  await controller.startExport('remote');

  assert.equal(state.downloads[0].filename, '季度需求.md');
  assert.equal(await state.downloads[0].blob.text(), '# 需求');
});

test('本地化模式先展示精确图片域名且不立即申请权限', async () => {
  const { controller, state } = createHarness({
    fetchImpl: async () =>
      markdownResponse(
        '![a](https://cdn.test/a.png)\n![b](https://other.test/b.jpg)'
      )
  });
  await controller.initialize();

  await controller.startExport('local');

  assert.deepEqual(state.permission, [
    'https://cdn.test/*',
    'https://other.test/*'
  ]);
  assert.deepEqual(state.permissionRequests, []);
  assert.deepEqual(state.downloads, []);
});

test('从本地化切回原地址导出时隐藏旧授权面板', async () => {
  const { controller, state } = createHarness({
    fetchImpl: async () => markdownResponse('![a](https://cdn.test/a.png)')
  });
  await controller.initialize();
  await controller.startExport('local');

  await controller.startExport('remote');

  assert.deepEqual(state.permission, []);
  assert.equal(state.downloads[0].filename, '季度需求.md');
});

test('用户拒绝图片权限时不生成文件', async () => {
  const { controller, state } = createHarness({
    fetchImpl: async () => markdownResponse('![a](https://cdn.test/a.png)'),
    permissionGranted: false
  });
  await controller.initialize();
  await controller.startExport('local');

  await controller.grantAndContinue();

  assert.deepEqual(state.permissionRequests, [['https://cdn.test/*']]);
  assert.deepEqual(state.downloads, []);
  assert.equal(state.statuses.at(-1).kind, 'warning');
  assert.match(state.statuses.at(-1).message, /保持图片原地址/);
});

test('授权后生成包含本地图片的 ZIP 并报告部分失败', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/markdown?')) {
      return markdownResponse(
        '![ok](https://cdn.test/a.png)\n![bad](https://cdn.test/b.jpg)'
      );
    }
    if (url.endsWith('/a.png')) {
      return imageResponse([1, 2, 3]);
    }
    throw new TypeError('image blocked');
  };
  const { controller, state } = createHarness({ fetchImpl });
  await controller.initialize();
  await controller.startExport('local');

  await controller.grantAndContinue();

  assert.equal(state.downloads[0].filename, '季度需求.zip');
  const zipBytes = new Uint8Array(await state.downloads[0].blob.arrayBuffer());
  assert.equal(new DataView(zipBytes.buffer).getUint32(0, true), 0x04034b50);
  assert.deepEqual(state.statuses.at(-1), {
    kind: 'warning',
    message: '已导出 ZIP：1 张图片成功，1 张失败并保留原地址'
  });
});

test('操作异常后恢复非忙碌状态并展示错误', async () => {
  const { controller, state } = createHarness({
    fetchImpl: async () => {
      throw new TypeError('offline');
    }
  });
  await controller.initialize();

  await controller.copyMarkdown();

  assert.equal(state.busy.at(-1), false);
  assert.equal(state.statuses.at(-1).kind, 'error');
  assert.match(state.statuses.at(-1).message, /无法连接语雀/);
});
