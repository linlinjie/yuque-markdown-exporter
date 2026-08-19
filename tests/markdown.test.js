import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractRemoteImageUrls,
  rewriteRemoteImageUrls
} from '../lib/markdown.js';

test('按首次出现顺序提取并去重远程图片', () => {
  const source = [
    '![a](https://img.test/a.png)',
    '<img alt="b" src="https://img.test/b.jpg">',
    '![again](https://img.test/a.png)'
  ].join('\n');

  assert.deepEqual(extractRemoteImageUrls(source), [
    'https://img.test/a.png',
    'https://img.test/b.jpg'
  ]);
});

test('识别带尖括号和标题的 Markdown 图片', () => {
  assert.deepEqual(
    extractRemoteImageUrls('![架构图](<https://img.test/a path.png> "说明")'),
    ['https://img.test/a path.png']
  );
});

test('识别单引号和双引号 HTML 图片', () => {
  const source = [
    "<img src='https://img.test/a.png' loading='lazy'>",
    '<IMG SRC="http://img.test/b.gif">'
  ].join('\n');

  assert.deepEqual(extractRemoteImageUrls(source), [
    'https://img.test/a.png',
    'http://img.test/b.gif'
  ]);
});

test('忽略普通链接、相对路径和 data URL', () => {
  const source = [
    '[图片](https://img.test/not-an-image.png)',
    '![relative](./local.png)',
    '![inline](data:image/png;base64,AAAA)'
  ].join('\n');

  assert.deepEqual(extractRemoteImageUrls(source), []);
});

test('只改写映射中成功下载的图片并保留原格式', () => {
  const source = [
    '![a](https://img.test/a.png "标题")',
    '![b](<https://img.test/b path.jpg>)',
    '<img class="preview" src="https://img.test/c.webp">'
  ].join('\n');
  const replacements = new Map([
    ['https://img.test/a.png', 'images/image-001.png'],
    ['https://img.test/c.webp', 'images/image-003.webp']
  ]);

  assert.equal(
    rewriteRemoteImageUrls(source, replacements),
    [
      '![a](images/image-001.png "标题")',
      '![b](<https://img.test/b path.jpg>)',
      '<img class="preview" src="images/image-003.webp">'
    ].join('\n')
  );
});
