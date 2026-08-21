import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readProjectFile(path) {
  return readFile(resolve(projectRoot, path), 'utf8');
}

test('Manifest 声明 v2 最小固定权限和按需图片权限', async () => {
  const manifest = JSON.parse(await readProjectFile('manifest.json'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '2.1.5');
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.deepEqual([...manifest.permissions].sort(), [
    'activeTab',
    'clipboardWrite',
    'scripting'
  ]);
  assert.deepEqual([...manifest.host_permissions].sort(), [
    'http://*.yuque.com/*',
    'http://yuque.com/*',
    'https://*.yuque.com/*',
    'https://yuque.com/*'
  ]);
  assert.deepEqual([...manifest.optional_host_permissions].sort(), [
    'http://*/*',
    'https://*/*'
  ]);
  assert.deepEqual(manifest.background, {
    service_worker: 'background/service-worker.js',
    type: 'module'
  });
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: [
        'lib/table-capture.js',
        'lib/table-page.js',
        'lib/yuque-doc.js',
        'lib/sheet-parse.js'
      ],
      matches: [
        'http://yuque.com/*',
        'http://*.yuque.com/*',
        'https://yuque.com/*',
        'https://*.yuque.com/*'
      ]
    }
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

test('Manifest 声明的 v2 运行文件和预览资源都存在', async () => {
  const manifest = JSON.parse(await readProjectFile('manifest.json'));
  const declaredFiles = [
    manifest.background.service_worker,
    ...manifest.web_accessible_resources.flatMap(({ resources }) => resources),
    'content/table-bridge.js',
    'viewer/viewer.html',
    'viewer/viewer.css',
    'viewer/viewer.js'
  ];

  await Promise.all(
    declaredFiles.map((path) => access(resolve(projectRoot, path)))
  );
});
