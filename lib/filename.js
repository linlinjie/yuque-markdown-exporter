const MIME_EXTENSIONS = new Map([
  ['image/avif', '.avif'],
  ['image/bmp', '.bmp'],
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp'],
  ['image/x-icon', '.ico']
]);

const SAFE_IMAGE_EXTENSIONS = new Map([
  ['.avif', '.avif'],
  ['.bmp', '.bmp'],
  ['.gif', '.gif'],
  ['.ico', '.ico'],
  ['.jpeg', '.jpg'],
  ['.jpg', '.jpg'],
  ['.png', '.png'],
  ['.svg', '.svg'],
  ['.webp', '.webp']
]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function cleanFilename(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/[. ]+$/g, '');
}

export function sanitizeFilename(title, fallback = '语雀文档') {
  let result = cleanFilename(title) || cleanFilename(fallback) || '语雀文档';

  result = Array.from(result).slice(0, 120).join('').replace(/[. ]+$/g, '');
  if (!result) {
    result = '语雀文档';
  }

  if (WINDOWS_RESERVED.test(result)) {
    result = `_${result}`;
  }

  return result;
}

export function inferImageExtension(contentType, rawUrl) {
  const mime = String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();
  if (MIME_EXTENSIONS.has(mime)) {
    return MIME_EXTENSIONS.get(mime);
  }

  try {
    const pathname = new URL(rawUrl).pathname;
    const match = pathname.match(/(\.[a-z0-9]+)$/i);
    const extension = match?.[1].toLowerCase();
    if (SAFE_IMAGE_EXTENSIONS.has(extension)) {
      return SAFE_IMAGE_EXTENSIONS.get(extension);
    }
  } catch {
    // The generic binary extension below is safe for malformed URLs.
  }

  return '.bin';
}
