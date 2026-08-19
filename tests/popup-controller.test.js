import test from 'node:test';
import assert from 'node:assert/strict';

import { createPopupController } from '../lib/popup-controller.js';

function markdownResponse(markdown) {
  return new Response(markdown, {
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
    url: 'https://team.yuque.com/org/repo/doc',
    title: '季度需求'
  },
  fetchImpl = async () => markdownResponse('# 需求'),
  permissionGranted = true
} = {}) {
  const state = {
    page: undefined,
    busy: [],
    statuses: [],
    permission: undefined,
    opened: [],
    copied: [],
    downloads: [],
    permissionRequests: []
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
    }
  };

  const browser = {
    async getActiveTab() {
      return tab;
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
    tab: { url: 'https://example.com/page', title: '普通网页' }
  });

  await controller.initialize();

  assert.deepEqual(state.page, {
    supported: false,
    title: '普通网页',
    reason: '当前页面不是语雀页面'
  });
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
