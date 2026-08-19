import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readProjectFile(path) {
  return readFile(resolve(projectRoot, path), 'utf8');
}

test('Manifest 声明最小固定权限和按需图片权限', async () => {
  const manifest = JSON.parse(await readProjectFile('manifest.json'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'clipboardWrite']);
  assert.deepEqual([...manifest.host_permissions].sort(), [
    'https://*.yuque.com/*',
    'https://yuque.com/*'
  ]);
  assert.deepEqual([...manifest.optional_host_permissions].sort(), [
    'http://*/*',
    'https://*/*'
  ]);
});

test('Manifest 指向的弹窗文件及其本地资源都存在', async () => {
  const manifest = JSON.parse(await readProjectFile('manifest.json'));
  const popupPath = resolve(projectRoot, manifest.action.default_popup);
  const popupHtml = await readFile(popupPath, 'utf8');
  const references = [
    ...popupHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi)
  ].map((match) => match[1]);

  assert.deepEqual(references.sort(), ['./popup.css', './popup.js']);
  await Promise.all(
    references.map((reference) => access(resolve(dirname(popupPath), reference)))
  );
});
