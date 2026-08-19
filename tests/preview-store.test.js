import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewStore } from '../background/service-worker.js';

test('Markdown 预览只能读取一次', () => {
  const store = createPreviewStore({
    now: () => 1000,
    ttlMs: 60_000,
    createToken: () => 'token-1'
  });

  assert.equal(store.create({ title: '表', text: '# 表' }), 'token-1');
  assert.deepEqual(store.take('token-1'), { title: '表', text: '# 表' });
  assert.equal(store.take('token-1'), undefined);
});

test('超过有效期的 Markdown 预览不再返回内容', () => {
  let clock = 1000;
  const store = createPreviewStore({
    now: () => clock,
    ttlMs: 60_000,
    createToken: () => 'token-2'
  });
  store.create({ title: '表', text: '# 表' });

  clock = 61_001;

  assert.equal(store.take('token-2'), undefined);
});
