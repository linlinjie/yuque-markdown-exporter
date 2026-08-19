import { createPopupController } from '../lib/popup-controller.js';

const elements = {
  title: document.querySelector('#document-title'),
  pageState: document.querySelector('#page-state'),
  pageDot: document.querySelector('#page-dot'),
  viewButton: document.querySelector('#view-button'),
  copyButton: document.querySelector('#copy-button'),
  exportButton: document.querySelector('#export-button'),
  exportOptions: document.querySelector('#export-options'),
  permissionPanel: document.querySelector('#permission-panel'),
  permissionOrigins: document.querySelector('#permission-origins'),
  permissionButton: document.querySelector('#permission-button'),
  status: document.querySelector('#status')
};

let pageSupported = false;
let busy = false;

function updateDisabledState() {
  elements.viewButton.disabled = busy || !pageSupported;
  elements.copyButton.disabled = busy || !pageSupported;
  elements.exportButton.disabled = busy || !pageSupported;
  elements.exportOptions.disabled = busy || !pageSupported;
  elements.permissionButton.disabled = busy;
}

const view = {
  renderPage({ supported, title, reason }) {
    pageSupported = supported;
    elements.title.textContent = title;
    elements.pageState.textContent = supported ? '已识别语雀文档' : reason;
    elements.pageDot.className = `state-dot ${supported ? 'supported' : 'unsupported'}`;
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
  }
};

const browser = {
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  },

  openTab(url) {
    return chrome.tabs.create({ url });
  },

  copyText(text) {
    return navigator.clipboard.writeText(text);
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
  const mode = document.querySelector('input[name="export-mode"]:checked').value;
  void controller.startExport(mode);
});

elements.permissionButton.addEventListener('click', () => {
  void controller.grantAndContinue();
});

controller.initialize().catch((error) => {
  view.renderPage({
    supported: false,
    title: '无法读取当前标签页',
    reason: error instanceof Error ? error.message : String(error)
  });
});
