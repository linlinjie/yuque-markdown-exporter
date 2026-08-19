import { createPopupController } from '../lib/popup-controller.js';

const elements = {
  title: document.querySelector('#document-title'),
  pageState: document.querySelector('#page-state'),
  pageDot: document.querySelector('#page-dot'),
  viewButton: document.querySelector('#view-button'),
  copyButton: document.querySelector('#copy-button'),
  exportButton: document.querySelector('#export-button'),
  documentExportOptions: document.querySelector('#document-export-options'),
  tableExportOptions: document.querySelector('#table-export-options'),
  permissionPanel: document.querySelector('#permission-panel'),
  permissionOrigins: document.querySelector('#permission-origins'),
  permissionButton: document.querySelector('#permission-button'),
  status: document.querySelector('#status')
};

let pageSupported = false;
let pageKind = 'unsupported';
let busy = false;
let activeTabId;

function updateDisabledState() {
  elements.viewButton.disabled = busy || !pageSupported;
  elements.copyButton.disabled = busy || !pageSupported;
  elements.exportButton.disabled = busy || !pageSupported;
  elements.documentExportOptions.disabled = busy || !pageSupported;
  elements.tableExportOptions.disabled = busy || !pageSupported;
  elements.permissionButton.disabled = busy;
}

const view = {
  renderPage({ supported, kind, title, reason }) {
    pageSupported = supported;
    pageKind = kind;
    elements.title.textContent = title;
    elements.pageState.textContent = supported
      ? kind === 'table'
        ? '已识别语雀表格/看板'
        : '已识别语雀文档'
      : reason;
    elements.pageDot.className = `state-dot ${supported ? 'supported' : 'unsupported'}`;
    elements.documentExportOptions.hidden = kind !== 'document';
    elements.tableExportOptions.hidden = kind !== 'table';
    if (kind === 'table') {
      elements.permissionPanel.hidden = true;
    }
    updateDisabledState();
  },

  setBusy(value) {
    busy = value;
    updateDisabledState();
  },

  showStatus(kind, message) {
    elements.status.hidden = false;
    elements.status.className = `status ${kind}`;
    elements.status.textContent = message;
  },

  showPermissionStep(origins) {
    elements.permissionOrigins.replaceChildren();
    for (const origin of origins) {
      const item = document.createElement('li');
      item.textContent = origin;
      elements.permissionOrigins.append(item);
    }
    elements.permissionPanel.hidden = origins.length === 0;
  },

  showCaptureProgress(message) {
    this.showStatus('info', message);
  }
};

async function installTableBridge(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/table-bridge.js']
  });
}

async function sendTableMessage(tabId, type) {
  await installTableBridge(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { type });
  if (!response?.ok) {
    const error = new Error(
      response?.error?.message ?? '无法读取语雀表格页面'
    );
    error.code = response?.error?.code;
    throw error;
  }
  return response.value;
}

const browser = {
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id;
    return tab;
  },

  inspectStructuredPage(tabId) {
    return sendTableMessage(tabId, 'YUQUE_TABLE_INSPECT');
  },

  captureStructuredTable(tabId) {
    return sendTableMessage(tabId, 'YUQUE_TABLE_CAPTURE');
  },

  openTab(url) {
    return chrome.tabs.create({ url });
  },

  copyText(text) {
    return navigator.clipboard.writeText(text);
  },

  async openGeneratedMarkdown({ title, markdown }) {
    const { token } = await chrome.runtime.sendMessage({
      type: 'YUQUE_PREVIEW_CREATE',
      title,
      text: markdown
    });
    await chrome.tabs.create({
      url: chrome.runtime.getURL(
        `viewer/viewer.html#${encodeURIComponent(token)}`
      )
    });
  },

  requestOrigins(origins) {
    return chrome.permissions.request({ origins });
  },

  async downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    message?.type === 'YUQUE_TABLE_PROGRESS' &&
    sender.tab?.id === activeTabId
  ) {
    view.showCaptureProgress(message.message);
  }
  return false;
});

const controller = createPopupController({
  browser,
  view,
  fetchImpl: globalThis.fetch.bind(globalThis)
});

elements.viewButton.addEventListener('click', () => {
  void controller.viewMarkdown();
});

elements.copyButton.addEventListener('click', () => {
  void controller.copyMarkdown();
});

elements.exportButton.addEventListener('click', () => {
  const radioName =
    pageKind === 'table' ? 'table-export-mode' : 'export-mode';
  const mode = document.querySelector(`input[name="${radioName}"]:checked`).value;
  void controller.startExport(mode);
});

elements.permissionButton.addEventListener('click', () => {
  void controller.grantAndContinue();
});

controller.initialize().catch((error) => {
  view.renderPage({
    supported: false,
    kind: 'unsupported',
    title: '无法读取当前标签页',
    reason: error instanceof Error ? error.message : String(error)
  });
});
