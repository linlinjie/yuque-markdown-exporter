import test from 'node:test';
import assert from 'node:assert/strict';

import { renderPreview } from '../viewer/viewer.js';

function fakeViewerDocument() {
  const nodes = {
    '#preview-title': { textContent: '' },
    '#preview-content': { textContent: '' },
    '#preview-status': { textContent: '', hidden: false }
  };
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
