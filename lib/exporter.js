import { inferImageExtension } from './filename.js';
import {
  extractRemoteImageUrls,
  rewriteRemoteImageUrls
} from './markdown.js';

export class ExportError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ExportError';
    this.code = code;
  }
}

export async function fetchMarkdownText(fetchImpl, markdownUrl) {
  let response;

  try {
    response = await fetchImpl(markdownUrl, {
      credentials: 'include',
      cache: 'no-store'
    });
  } catch (cause) {
    throw new ExportError('NETWORK_ERROR', '无法连接语雀，请检查网络后重试', {
      cause
    });
  }

  if (!response.ok) {
    throw new ExportError(
      'HTTP_ERROR',
      `语雀返回 HTTP ${response.status}，请确认登录状态和文档权限`
    );
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const redirectedToLogin = /(?:^|\/)(?:login|signin)(?:\/|$)/i.test(
    response.url ? new URL(response.url).pathname : ''
  );
  if (contentType.includes('text/html') || redirectedToLogin) {
    throw new ExportError('AUTH_REQUIRED', '读取到登录页面，请重新登录语雀');
  }

  const markdown = await response.text();
  if (!markdown.trim()) {
    throw new ExportError('EMPTY_MARKDOWN', 'Markdown 内容为空');
  }

  return markdown;
}

export function collectImageOrigins(urls) {
  const origins = [];
  const seen = new Set();

  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        continue;
      }

      const pattern = `${url.origin}/*`;
      if (!seen.has(pattern)) {
        seen.add(pattern);
        origins.push(pattern);
      }
    } catch {
      // Invalid image URLs are not permission candidates.
    }
  }

  return origins;
}

function errorMessage(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}

export async function localizeImages(markdown, fetchImpl) {
  const urls = extractRemoteImageUrls(markdown);
  const downloads = urls.map(async (url, index) => {
    const response = await fetchImpl(url, {
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const extension = inferImageExtension(
      response.headers.get('content-type'),
      url
    );
    const number = String(index + 1).padStart(3, '0');

    return {
      url,
      name: `images/image-${number}${extension}`,
      data: new Uint8Array(await response.arrayBuffer())
    };
  });

  const settled = await Promise.allSettled(downloads);
  const replacements = new Map();
  const images = [];
  const failed = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const { url, name, data } = result.value;
      replacements.set(url, name);
      images.push({ name, data });
      return;
    }

    failed.push({
      url: urls[index],
      message: errorMessage(result.reason)
    });
  });

  return {
    markdown: rewriteRemoteImageUrls(markdown, replacements),
    images,
    succeeded: images.length,
    failed
  };
}
