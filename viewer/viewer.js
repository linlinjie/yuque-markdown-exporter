export function renderPreview(doc, preview) {
  const title = doc.querySelector('#preview-title');
  const content = doc.querySelector('#preview-content');
  const status = doc.querySelector('#preview-status');

  if (!preview) {
    title.textContent = 'Markdown 预览';
    content.textContent = '';
    status.textContent = '预览已过期，请回到语雀页面重新生成。';
    status.hidden = false;
    return;
  }

  title.textContent = preview.title;
  content.textContent = preview.text;
  status.textContent = '';
  status.hidden = true;
}

async function loadPreview() {
  const token = decodeURIComponent(globalThis.location.hash.slice(1));
  const preview = token
    ? await chrome.runtime.sendMessage({
        type: 'YUQUE_PREVIEW_TAKE',
        token
      })
    : undefined;
  renderPreview(document, preview);
  if (preview?.title) {
    document.title = `${preview.title} - Markdown 预览`;
  }
}

if (globalThis.document && globalThis.chrome?.runtime) {
  void loadPreview();
}
