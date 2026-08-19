const encoder = new TextEncoder();
const UTF8_FLAG = 0x0800;
const ZIP32_MAX = 0xffffffff;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function asBytes(data) {
  if (typeof data === 'string') {
    return encoder.encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  throw new TypeError('ZIP 文件内容必须是字符串或 Uint8Array');
}

function concat(chunks, totalLength) {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function localHeader(entry) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.name.length, true);
  return header;
}

function centralHeader(entry) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, 0, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(42, entry.offset, true);
  return header;
}

function endOfCentralDirectory(count, size, offset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return record;
}

export function createZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ZIP 至少包含一个文件');
  }
  if (entries.length > 0xffff) {
    throw new Error('ZIP32 文件数量超出限制');
  }

  const names = new Set();
  const prepared = [];
  let localSize = 0;

  for (const item of entries) {
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new Error('ZIP 文件名不能为空');
    }
    if (names.has(item.name)) {
      throw new Error(`ZIP 文件名重复：${item.name}`);
    }
    names.add(item.name);

    const name = encoder.encode(item.name);
    const data = asBytes(item.data);
    if (name.length > 0xffff || data.length > ZIP32_MAX) {
      throw new Error('ZIP32 单个文件超出限制');
    }

    const entry = {
      name,
      data,
      crc: crc32(data),
      offset: localSize
    };
    prepared.push(entry);
    localSize += 30 + name.length + data.length;
    if (localSize > ZIP32_MAX) {
      throw new Error('ZIP32 偏移超出限制');
    }
  }

  const localChunks = [];
  const centralChunks = [];
  let centralSize = 0;

  for (const entry of prepared) {
    localChunks.push(localHeader(entry), entry.name, entry.data);
    const header = centralHeader(entry);
    centralChunks.push(header, entry.name);
    centralSize += header.length + entry.name.length;
  }

  if (localSize + centralSize + 22 > ZIP32_MAX) {
    throw new Error('ZIP32 总大小超出限制');
  }

  const end = endOfCentralDirectory(prepared.length, centralSize, localSize);
  return concat(
    [...localChunks, ...centralChunks, end],
    localSize + centralSize + end.length
  );
}
