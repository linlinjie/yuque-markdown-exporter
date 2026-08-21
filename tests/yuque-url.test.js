import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectYuqueUrl } from '../lib/yuque-url.js';

test('企业语雀文档转换为 plain Markdown 地址', () => {
  assert.deepEqual(
    inspectYuqueUrl('https://team.yuque.com/org/repo/doc?x=1#part'),
    {
      supported: true,
      sourceUrl: 'https://team.yuque.com/org/repo/doc',
      markdownUrl:
        'https://team.yuque.com/org/repo/doc/markdown?plain=true&linebreak=false&anchor=false',
      namespace: 'org/repo',
      slug: 'doc',
      docApiUrl: 'https://team.yuque.com/api/v2/repos/org/repo/docs/doc'
    }
  );
});

test('已有 Markdown 后缀不会重复追加', () => {
  assert.deepEqual(
    inspectYuqueUrl(
      'https://zhyk.yuque.com/oa6mm8/layc61/fgbk8xpmd41u7gkw/markdown?plain=false'
    ),
    {
      supported: true,
      sourceUrl: 'https://zhyk.yuque.com/oa6mm8/layc61/fgbk8xpmd41u7gkw',
      markdownUrl:
        'https://zhyk.yuque.com/oa6mm8/layc61/fgbk8xpmd41u7gkw/markdown?plain=true&linebreak=false&anchor=false',
      namespace: 'oa6mm8/layc61',
      slug: 'fgbk8xpmd41u7gkw',
      docApiUrl:
        'https://zhyk.yuque.com/api/v2/repos/oa6mm8/layc61/docs/fgbk8xpmd41u7gkw'
    }
  );
});

test('根域名文档受支持', () => {
  assert.equal(
    inspectYuqueUrl('https://yuque.com/acme/repo/spec').supported,
    true
  );
});

test('拒绝伪装成语雀子域名的主机', () => {
  assert.equal(
    inspectYuqueUrl('https://yuque.com.evil.test/org/repo/doc').supported,
    false
  );
});

test('拒绝语雀系统页面', () => {
  for (const path of ['/login', '/search?q=test', '/account/settings']) {
    assert.equal(inspectYuqueUrl(`https://www.yuque.com${path}`).supported, false);
  }
});

test('拒绝路径片段不足的页面', () => {
  assert.equal(inspectYuqueUrl('https://team.yuque.com/org').supported, false);
});

test('拒绝非法 URL 和非 HTTP 协议', () => {
  assert.equal(inspectYuqueUrl('not a url').supported, false);
  assert.equal(inspectYuqueUrl('chrome://extensions').supported, false);
});
