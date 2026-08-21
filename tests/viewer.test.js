import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindPreviewActions,
  copyPreview,
  exportPreview,
  renderPreview,
  showPreviewStatus
} from '../viewer/viewer.js';

function fakeButton() {
  return {
    disabled: false,
    hidden: false,
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    async click() {
      await this.listeners.click?.();
    }
  };
}

function fakeViewerDocument({ withActions = false } = {}) {
  const nodes = {
    '#preview-title': { textContent: '' },
    '#preview-content': { textContent: '' },
    '#preview-status': { textContent: '', hidden: false, className: 'status' }
  };
  if (withActions) {
    nodes['#preview-actions'] = { hidden: true };
    nodes['#copy-button'] = fakeButton();
    nodes['#export-button'] = fakeButton();
  }
  return {
    nodes,
    querySelector(selector) {
      return nodes[selector];
    }
  };
}

test('Markdown 预览使用 textContent 渲染而不解释 HTML', () => {
  const doc = fakeViewerDocument();

  renderPreview(doc, {
    title: '需求表',
    text: '# 标题\n<script>alert(1)</script>'
  });

  assert.equal(doc.nodes['#preview-title'].textContent, '需求表');
  assert.equal(
    doc.nodes['#preview-content'].textContent,
    '# 标题\n<script>alert(1)</script>'
  );
  assert.equal(doc.nodes['#preview-status'].hidden, true);
});

test('预览不存在时显示过期提示', () => {
  const doc = fakeViewerDocument();

  renderPreview(doc, undefined);

  assert.equal(doc.nodes['#preview-content'].textContent, '');
  assert.equal(doc.nodes['#preview-status'].hidden, false);
  assert.match(doc.nodes['#preview-status'].textContent, /已过期/);
});

test('有效预览显示复制和导出按钮，过期后隐藏', () => {
  const doc = fakeViewerDocument({ withActions: true });

  renderPreview(doc, { title: '早会看板', text: '| 事项 |' });
  assert.equal(doc.nodes['#preview-actions'].hidden, false);
  assert.equal(doc.nodes['#copy-button'].disabled, false);
  assert.equal(doc.nodes['#export-button'].disabled, false);

  renderPreview(doc, undefined);
  assert.equal(doc.nodes['#preview-actions'].hidden, true);
  assert.equal(doc.nodes['#copy-button'].disabled, true);
  assert.equal(doc.nodes['#export-button'].disabled, true);
});

test('复制预览 Markdown 到剪贴板', async () => {
  const writes = [];
  await copyPreview(
    { title: '早会看板', text: '# 看板\n' },
    {
      clipboard: {
        async writeText(text) {
          writes.push(text);
        }
      }
    }
  );
  assert.deepEqual(writes, ['# 看板\n']);
});

test('导出预览为 Markdown 文件', async () => {
  const downloads = [];
  await exportPreview(
    { title: '202608员工服务早会看板', text: '| 待办事项 |' },
    {
      async downloadBlob(blob, filename) {
        downloads.push({
          filename,
          type: blob.type,
          text: await blob.text()
        });
      }
    }
  );
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].filename, '202608员工服务早会看板.md');
  assert.equal(downloads[0].type, 'text/markdown;charset=utf-8');
  assert.equal(downloads[0].text, '| 待办事项 |');
});

test('预览页按钮复制并导出当前 Markdown', async () => {
  const doc = fakeViewerDocument({ withActions: true });
  const preview = { title: '需求表', text: '# 需求\n' };
  const writes = [];
  const downloads = [];

  renderPreview(doc, preview);
  bindPreviewActions(doc, {
    getPreview: () => preview,
    clipboard: {
      async writeText(text) {
        writes.push(text);
      }
    },
    async saveBlob(blob, filename) {
      downloads.push({ filename, text: await blob.text() });
    }
  });

  await doc.nodes['#copy-button'].click();
  assert.deepEqual(writes, ['# 需求\n']);
  assert.equal(doc.nodes['#preview-status'].className, 'status success');
  assert.match(doc.nodes['#preview-status'].textContent, /已复制/);

  await doc.nodes['#export-button'].click();
  assert.deepEqual(downloads, [
    { filename: '需求表.md', text: '# 需求\n' }
  ]);
  assert.match(doc.nodes['#preview-status'].textContent, /已导出/);
});

test('过期预览复制时给出明确提示', async () => {
  await assert.rejects(
    copyPreview(undefined, { clipboard: { writeText: async () => {} } }),
    /已过期/
  );
});

test('状态提示会切换样式', () => {
  const doc = fakeViewerDocument();
  showPreviewStatus(doc, 'success', 'Markdown 已复制到剪贴板');
  assert.equal(doc.nodes['#preview-status'].hidden, false);
  assert.equal(doc.nodes['#preview-status'].className, 'status success');
});
