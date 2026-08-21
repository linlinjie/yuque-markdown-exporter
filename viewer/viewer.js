import { sanitizeFilename } from '../lib/filename.js';

const EXPIRED_MESSAGE = '预览已过期，请回到语雀页面重新生成。';

export function showPreviewStatus(doc, kind, message) {
  const status = doc.querySelector('#preview-status');
  if (!status) {
    return;
  }
  status.className = `status ${kind}`;
  status.textContent = message;
  status.hidden = !message;
}

export function renderPreview(doc, preview) {
  const title = doc.querySelector('#preview-title');
  const content = doc.querySelector('#preview-content');
  const actions = doc.querySelector('#preview-actions');
  const copyButton = doc.querySelector('#copy-button');
  const exportButton = doc.querySelector('#export-button');
  const hasPreview = Boolean(preview);

  title.textContent = preview?.title || 'Markdown 预览';
  content.textContent = preview?.text ?? '';
  if (actions) {
    actions.hidden = !hasPreview;
  }
  if (copyButton) {
    copyButton.disabled = !hasPreview;
  }
  if (exportButton) {
    exportButton.disabled = !hasPreview;
  }

  if (!hasPreview) {
    showPreviewStatus(doc, 'error', EXPIRED_MESSAGE);
    return;
  }

  showPreviewStatus(doc, 'info', '');
}

export async function copyPreview(preview, { clipboard }) {
  if (!preview) {
    throw new Error(EXPIRED_MESSAGE);
  }
  await clipboard.writeText(preview.text ?? '');
}

export async function exportPreview(preview, { downloadBlob }) {
  if (!preview) {
    throw new Error(EXPIRED_MESSAGE);
  }
  await downloadBlob(
    new Blob([preview.text ?? ''], { type: 'text/markdown;charset=utf-8' }),
    `${sanitizeFilename(preview.title)}.md`
  );
}

export function downloadBlob(blob, filename, doc = document) {
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  doc.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bindPreviewActions(
  doc,
  {
    getPreview,
    clipboard = navigator.clipboard,
    saveBlob = (blob, filename) => downloadBlob(blob, filename, doc)
  } = {}
) {
  const copyButton = doc.querySelector('#copy-button');
  const exportButton = doc.querySelector('#export-button');

  copyButton?.addEventListener('click', async () => {
    try {
      await copyPreview(getPreview(), { clipboard });
      showPreviewStatus(doc, 'success', 'Markdown 已复制到剪贴板');
    } catch (error) {
      showPreviewStatus(
        doc,
        'error',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  exportButton?.addEventListener('click', async () => {
    try {
      await exportPreview(getPreview(), { downloadBlob: saveBlob });
      showPreviewStatus(doc, 'success', 'Markdown 文件已导出');
    } catch (error) {
      showPreviewStatus(
        doc,
        'error',
        error instanceof Error ? error.message : String(error)
      );
    }
  });
}

async function loadPreview() {
  const token = decodeURIComponent(globalThis.location.hash.slice(1));
  const preview = token
    ? await chrome.runtime.sendMessage({
        type: 'YUQUE_PREVIEW_TAKE',
        token
      })
    : undefined;
  let currentPreview = preview;
  renderPreview(document, currentPreview);
  bindPreviewActions(document, {
    getPreview() {
      return currentPreview;
    }
  });
  if (preview?.title) {
    document.title = `${preview.title} - Markdown 预览`;
  }
}

if (globalThis.document && globalThis.chrome?.runtime) {
  void loadPreview();
}
