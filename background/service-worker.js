export function createPreviewStore({
  now = Date.now,
  ttlMs = 60_000,
  createToken = () => crypto.randomUUID()
} = {}) {
  const previews = new Map();

  return {
    create(preview) {
      const token = createToken();
      previews.set(token, {
        preview,
        expiresAt: now() + ttlMs
      });
      return token;
    },

    take(token) {
      const entry = previews.get(token);
      previews.delete(token);
      if (!entry || now() > entry.expiresAt) {
        return undefined;
      }
      return entry.preview;
    }
  };
}

const previewStore = createPreviewStore();

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'YUQUE_PREVIEW_CREATE') {
      const token = previewStore.create({
        title: String(message.title ?? 'Markdown 预览'),
        text: String(message.text ?? '')
      });
      sendResponse({ token });
      return false;
    }

    if (message?.type === 'YUQUE_PREVIEW_TAKE') {
      sendResponse(previewStore.take(message.token));
      return false;
    }

    return false;
  });
}
