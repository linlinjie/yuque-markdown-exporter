import { isStructuredDoc } from './sheet-parse.js';

export const SHEET_ROOT_SELECTOR = [
  '[class*="lake-sheet"]',
  '[class*="lakesheet"]',
  '[class*="LakeSheet"]',
  '[data-testid*="sheet"]'
].join(', ');

export function readPageDocMeta(doc = document) {
  const appData = doc.defaultView?.appData;
  const data = appData?.doc;
  if (!data && appData?.book == null) {
    return undefined;
  }
  return {
    type: data?.type,
    format: data?.format,
    title: data?.title,
    slug: data?.slug,
    bookId: appData?.book?.id,
    body: data?.body,
    body_sheet: data?.body_sheet,
    body_table: data?.body_table,
    content: data?.content,
    body_asl: data?.body_asl
  };
}

export function pageLooksLikeSheet(doc = document) {
  const meta = readPageDocMeta(doc);
  if (meta?.type === 'Sheet' || meta?.format === 'lakesheet') {
    return true;
  }
  return (doc.querySelectorAll?.(SHEET_ROOT_SELECTOR)?.length ?? 0) > 0;
}

function unwrapDoc(payload, fallback = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  return {
    type: data.type ?? fallback.type,
    format: data.format ?? fallback.format,
    title: data.title ?? fallback.title,
    slug: data.slug ?? fallback.slug,
    body: data.body,
    body_sheet: data.body_sheet,
    body_table: data.body_table,
    content: data.content ?? data.body_asl,
    body_asl: data.body_asl
  };
}

async function fetchDocCandidate(fetchImpl, url) {
  const response = await fetchImpl(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  if (!response.ok) {
    return undefined;
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/html')) {
    return undefined;
  }
  return unwrapDoc(await response.json());
}

export async function fetchPageDocument({
  doc = document,
  fetchImpl,
  locationHref = doc.location?.href
} = {}) {
  const meta = readPageDocMeta(doc);
  let url;
  try {
    url = new URL(locationHref);
  } catch {
    return isStructuredDoc(meta) ? meta : undefined;
  }

  if (meta?.type === 'Doc' && meta.format !== 'lakesheet' && meta.format !== 'laketable') {
    return undefined;
  }

  const fetchFn =
    fetchImpl ??
    doc.defaultView?.fetch?.bind(doc.defaultView) ??
    globalThis.fetch.bind(globalThis);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.at(-1)?.toLowerCase() === 'markdown') {
    segments.pop();
  }
  const slug = meta?.slug || segments.at(-1);
  const bookId = meta?.bookId;
  const candidates = [];

  if (bookId && slug) {
    candidates.push(
      `${url.origin}/api/docs/${encodeURIComponent(slug)}?book_id=${encodeURIComponent(bookId)}&merge_dynamic_data=true`
    );
  }
  if (segments.length >= 3 && slug) {
    candidates.push(
      `${url.origin}/api/v2/repos/${encodeURIComponent(segments[0])}/${encodeURIComponent(segments[1])}/docs/${encodeURIComponent(slug)}`
    );
  }

  for (const candidate of candidates) {
    try {
      const data = await fetchDocCandidate(fetchFn, candidate);
      if (data && isStructuredDoc(data)) {
        return { ...meta, ...data };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return isStructuredDoc(meta) ? meta : undefined;
}
