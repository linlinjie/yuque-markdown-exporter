import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inferImageExtension,
  sanitizeFilename
} from '../lib/filename.js';

test('文件名移除跨平台非法字符和结尾点号', () => {
  assert.equal(sanitizeFilename('  需求:/\\*?"<>|  ... '), '需求');
});

test('空标题使用中文回退名称', () => {
  assert.equal(sanitizeFilename(' ... '), '语雀文档');
  assert.equal(sanitizeFilename('', '备用标题'), '备用标题');
});

test('Windows 保留名称添加安全前缀', () => {
  assert.equal(sanitizeFilename('CON'), '_CON');
  assert.equal(sanitizeFilename('lpt1.md'), '_lpt1.md');
});

test('文件名按 Unicode 字符限制为 120 个字符', () => {
  assert.equal(Array.from(sanitizeFilename('文'.repeat(130))).length, 120);
});

test('Content-Type 优先决定图片扩展名', () => {
  assert.equal(
    inferImageExtension('image/jpeg; charset=binary', 'https://x.test/a.png'),
    '.jpg'
  );
  assert.equal(inferImageExtension('image/svg+xml', 'https://x.test/a'), '.svg');
});

test('缺少可用 Content-Type 时从 URL 推断扩展名', () => {
  assert.equal(
    inferImageExtension('', 'https://x.test/path/photo.WEBP?download=1'),
    '.webp'
  );
  assert.equal(inferImageExtension('application/octet-stream', 'bad url'), '.bin');
});
