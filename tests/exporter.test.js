import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectImageOrigins,
  ExportError,
  fetchMarkdownText,
  localizeImages
} from '../lib/exporter.js';

function response(body, options = {}) {
  return new Response(body, {
    status: options.status ?? 200,
    headers: options.headers ?? { 'content-type': 'text/plain; charset=utf-8' }
  });
}

test('读取非空 Markdown 并携带登录态', async () => {
  let receivedOptions;
  const fetchImpl = async (_url, options) => {
    receivedOptions = options;
    return response('# 标题');
  };

  assert.equal(
    await fetchMarkdownText(fetchImpl, 'https://team.yuque.com/a/b/c/markdown'),
    '# 标题'
  );
  assert.deepEqual(receivedOptions, {
    credentials: 'include',
    cache: 'no-store'
  });
});

test('HTTP 非成功响应返回稳定错误码', async () => {
  await assert.rejects(
    fetchMarkdownText(async () => response('Forbidden', { status: 403 }), 'https://team.yuque.com/doc'),
    (error) => error instanceof ExportError && error.code === 'HTTP_ERROR'
  );
});

test('HTTP 错误保留状态码供结构化页面回退判断', async () => {
  await assert.rejects(
    fetchMarkdownText(
      async () => response('Not Found', { status: 404 }),
      'https://team.yuque.com/a/b/c/markdown'
    ),
    (error) =>
      error instanceof ExportError &&
      error.code === 'HTTP_ERROR' &&
      error.status === 404
  );
});

test('HTML 响应被识别为登录态失效', async () => {
  await assert.rejects(
    fetchMarkdownText(
      async () =>
        response('<!doctype html><title>登录</title>', {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        }),
      'https://team.yuque.com/doc'
    ),
    (error) => error instanceof ExportError && error.code === 'AUTH_REQUIRED'
  );
});

test('重定向到登录地址时即使响应类型异常也要求重新登录', async () => {
  const redirected = response('redirected');
  Object.defineProperty(redirected, 'url', {
    value: 'https://team.yuque.com/login?redirect=%2Fdoc'
  });

  await assert.rejects(
    fetchMarkdownText(async () => redirected, 'https://team.yuque.com/doc'),
    (error) => error instanceof ExportError && error.code === 'AUTH_REQUIRED'
  );
});

test('空白 Markdown 返回空内容错误', async () => {
  await assert.rejects(
    fetchMarkdownText(async () => response('  \n'), 'https://team.yuque.com/doc'),
    (error) => error instanceof ExportError && error.code === 'EMPTY_MARKDOWN'
  );
});

test('网络异常被包装为网络错误', async () => {
  await assert.rejects(
    fetchMarkdownText(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      'https://team.yuque.com/doc'
    ),
    (error) =>
      error instanceof ExportError &&
      error.code === 'NETWORK_ERROR' &&
      error.cause?.message === 'Failed to fetch'
  );
});

test('图片来源按首次出现顺序去重并区分协议', () => {
  assert.deepEqual(
    collectImageOrigins([
      'https://cdn.test/a.png',
      'https://cdn.test/b.png',
      'http://cdn.test/c.png',
      'not a url'
    ]),
    ['https://cdn.test/*', 'http://cdn.test/*']
  );
});

test('图片本地化保留失败链接并复用重复图片', async () => {
  const source = [
    '![first](https://img.test/a.png)',
    '<img src="https://img.test/b.jpg">',
    '![again](https://img.test/a.png)'
  ].join('\n');
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith('/a.png')) {
      return response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png' }
      });
    }
    throw new TypeError('blocked');
  };

  const result = await localizeImages(source, fetchImpl);

  assert.equal(
    result.markdown,
    [
      '![first](images/image-001.png)',
      '<img src="https://img.test/b.jpg">',
      '![again](images/image-001.png)'
    ].join('\n')
  );
  assert.deepEqual(result.images, [
    {
      name: 'images/image-001.png',
      data: new Uint8Array([137, 80, 78, 71])
    }
  ]);
  assert.equal(result.succeeded, 1);
  assert.deepEqual(result.failed, [
    { url: 'https://img.test/b.jpg', message: 'blocked' }
  ]);
  assert.deepEqual(requested, [
    'https://img.test/a.png',
    'https://img.test/b.jpg'
  ]);
});

test('图片输出顺序不受网络完成顺序影响', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/first.gif')) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return response(new Uint8Array([url.endsWith('/first.gif') ? 1 : 2]), {
      headers: { 'content-type': 'image/gif' }
    });
  };

  const result = await localizeImages(
    '![1](https://img.test/first.gif)\n![2](https://img.test/second.gif)',
    fetchImpl
  );

  assert.deepEqual(
    result.images.map(({ name, data }) => [name, [...data]]),
    [
      ['images/image-001.gif', [1]],
      ['images/image-002.gif', [2]]
    ]
  );
});
