import test from 'node:test';
import assert from 'node:assert/strict';

import { createZip } from '../lib/zip.js';

function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;

  while (view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;

    assert.equal(flags & 0x0800, 0x0800, 'entry must set the UTF-8 flag');
    assert.equal(method, 0, 'entry must use the store method');

    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }

  assert.equal(view.getUint32(offset, true), 0x02014b50);
  return entries;
}

test('生成的 ZIP 可读回 Markdown 和二进制图片', () => {
  const zip = createZip([
    { name: '文档.md', data: '# 标题' },
    {
      name: 'images/image-001.png',
      data: new Uint8Array([1, 2, 3])
    }
  ]);

  assert.deepEqual(
    readStoredZip(zip),
    new Map([
      ['文档.md', new TextEncoder().encode('# 标题')],
      ['images/image-001.png', new Uint8Array([1, 2, 3])]
    ])
  );
});

test('本地头写入标准 CRC-32', () => {
  const zip = createZip([{ name: 'fixture.txt', data: '123456789' }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  assert.equal(view.getUint32(14, true), 0xcbf43926);
});

test('拒绝空文件列表和重复文件名', () => {
  assert.throws(() => createZip([]), /至少包含一个文件/);
  assert.throws(
    () =>
      createZip([
        { name: 'same.md', data: 'a' },
        { name: 'same.md', data: 'b' }
      ]),
    /文件名重复/
  );
});

test('拒绝空文件名', () => {
  assert.throws(() => createZip([{ name: '', data: 'x' }]), /文件名不能为空/);
});
