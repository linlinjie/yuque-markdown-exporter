const MARKDOWN_QUERY = 'plain=true&linebreak=false&anchor=false';
const SYSTEM_ROOTS = new Set([
  'account',
  'dashboard',
  'explore',
  'login',
  'notifications',
  'search',
  'settings'
]);

function unsupported(reason) {
  return { supported: false, reason };
}

export function inspectYuqueUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    return unsupported('当前标签页地址无效');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return unsupported('当前标签页不是网页');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'yuque.com' && !hostname.endsWith('.yuque.com')) {
    return unsupported('当前页面不是语雀页面');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.at(-1)?.toLowerCase() === 'markdown') {
    segments.pop();
  }

  if (segments.length < 2 || SYSTEM_ROOTS.has(segments[0].toLowerCase())) {
    return unsupported('当前页面不是可导出的语雀文档');
  }

  const pathname = `/${segments.join('/')}`;
  const sourceUrl = `${url.origin}${pathname}`;

  return {
    supported: true,
    sourceUrl,
    markdownUrl: `${sourceUrl}/markdown?${MARKDOWN_QUERY}`
  };
}
