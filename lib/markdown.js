const MARKDOWN_IMAGE =
  /(!\[[^\]\r\n]*\]\(\s*)(?:<([^>\r\n]+)>|(https?:\/\/[^\s)\r\n]+))((?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\)\r\n]*\)))?\s*\))/gi;
const HTML_IMAGE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi;

function isRemoteImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function extractRemoteImageUrls(markdown) {
  const matches = [];

  for (const match of String(markdown ?? '').matchAll(MARKDOWN_IMAGE)) {
    const url = match[2] ?? match[3];
    if (isRemoteImageUrl(url)) {
      matches.push({ index: match.index, url });
    }
  }

  for (const match of String(markdown ?? '').matchAll(HTML_IMAGE)) {
    matches.push({ index: match.index, url: match[3] });
  }

  matches.sort((left, right) => left.index - right.index);
  return [...new Set(matches.map(({ url }) => url))];
}

export function rewriteRemoteImageUrls(markdown, replacements) {
  const replace = (url) => replacements.get(url) ?? url;

  return String(markdown ?? '')
    .replace(
      MARKDOWN_IMAGE,
      (full, prefix, angleUrl, bareUrl, suffix) =>
        angleUrl === undefined
          ? `${prefix}${replace(bareUrl)}${suffix}`
          : `${prefix}<${replace(angleUrl)}>${suffix}`
    )
    .replace(
      HTML_IMAGE,
      (full, prefix, quote, url) => `${prefix}${quote}${replace(url)}${quote}`
    );
}
