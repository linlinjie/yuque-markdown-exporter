(() => {
  if (globalThis.__YUQUE_TABLE_BRIDGE_INSTALLED__) {
    return;
  }
  globalThis.__YUQUE_TABLE_BRIDGE_INSTALLED__ = true;

  const supportedMessages = new Set([
    'YUQUE_TABLE_INSPECT',
    'YUQUE_TABLE_CAPTURE',
    'YUQUE_FETCH_DOC'
  ]);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!supportedMessages.has(message?.type)) {
      return false;
    }

    void (async () => {
      try {
        const page = await import(chrome.runtime.getURL('lib/table-page.js'));
        const value =
          message.type === 'YUQUE_TABLE_INSPECT'
            ? page.inspectStructuredPage()
            : message.type === 'YUQUE_FETCH_DOC'
              ? await page.fetchPageDocument()
              : await page.captureStructuredTable({
                  onProgress(progressMessage) {
                    void chrome.runtime
                      .sendMessage({
                        type: 'YUQUE_TABLE_PROGRESS',
                        message: progressMessage
                      })
                      .catch(() => {});
                  }
                });
        sendResponse({ ok: true, value });
      } catch (error) {
        sendResponse({
          ok: false,
          error: {
            code: error?.code ?? 'TABLE_CAPTURE_FAILED',
            message: error instanceof Error ? error.message : String(error),
            details: error?.details ?? {}
          }
        });
      }
    })();

    return true;
  });
})();
