import {
  collectImageOrigins,
  fetchMarkdownText,
  localizeImages
} from './exporter.js';
import { sanitizeFilename } from './filename.js';
import { extractRemoteImageUrls } from './markdown.js';
import { inspectYuqueUrl } from './yuque-url.js';
import { createZip } from './zip.js';

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createPopupController({ browser, view, fetchImpl }) {
  const state = {
    inspection: undefined,
    markdown: undefined,
    pending: undefined,
    title: '语雀文档'
  };

  function ensureSupported() {
    if (!state.inspection?.supported) {
      throw new Error(state.inspection?.reason ?? '当前页面不是可导出的语雀文档');
    }
  }

  async function run(action) {
    view.setBusy(true);
    try {
      return await action();
    } catch (error) {
      view.showStatus('error', messageOf(error));
      return undefined;
    } finally {
      view.setBusy(false);
    }
  }

  async function loadMarkdown() {
    ensureSupported();
    if (state.markdown === undefined) {
      state.markdown = await fetchMarkdownText(
        fetchImpl,
        state.inspection.markdownUrl
      );
    }
    return state.markdown;
  }

  async function downloadLocalized(markdown) {
    const result = await localizeImages(markdown, fetchImpl);
    const zip = createZip([
      { name: `${state.title}.md`, data: result.markdown },
      ...result.images
    ]);

    await browser.downloadBlob(
      new Blob([zip], { type: 'application/zip' }),
      `${state.title}.zip`
    );

    if (result.failed.length > 0) {
      view.showStatus(
        'warning',
        `已导出 ZIP：${result.succeeded} 张图片成功，${result.failed.length} 张失败并保留原地址`
      );
    } else {
      view.showStatus(
        'success',
        `已导出 ZIP：${result.succeeded} 张图片已保存到本地`
      );
    }
  }

  async function initialize() {
    const tab = await browser.getActiveTab();
    state.title = sanitizeFilename(tab?.title);
    state.inspection = inspectYuqueUrl(tab?.url);
    view.renderPage({
      supported: state.inspection.supported,
      title: state.title,
      reason: state.inspection.reason
    });
  }

  async function viewMarkdown() {
    return run(async () => {
      ensureSupported();
      await browser.openTab(state.inspection.markdownUrl);
      view.showStatus('success', '已在新标签页打开 Markdown');
    });
  }

  async function copyMarkdown() {
    return run(async () => {
      const markdown = await loadMarkdown();
      await browser.copyText(markdown);
      view.showStatus('success', 'Markdown 已复制到剪贴板');
    });
  }

  async function startExport(mode) {
    return run(async () => {
      const markdown = await loadMarkdown();

      if (mode === 'remote') {
        state.pending = undefined;
        view.showPermissionStep([]);
        await browser.downloadBlob(
          new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
          `${state.title}.md`
        );
        view.showStatus('success', 'Markdown 文件已导出');
        return;
      }

      if (mode !== 'local') {
        throw new Error('未知的导出模式');
      }

      const origins = collectImageOrigins(extractRemoteImageUrls(markdown));
      if (origins.length === 0) {
        state.pending = undefined;
        view.showPermissionStep([]);
        await downloadLocalized(markdown);
        return;
      }

      state.pending = { markdown, origins };
      view.showPermissionStep(origins);
      view.showStatus('info', '请确认图片域名权限后继续导出');
    });
  }

  function grantAndContinue() {
    if (!state.pending) {
      view.showStatus('error', '没有等待授权的导出任务');
      return Promise.resolve();
    }

    let permissionRequest;
    try {
      permissionRequest = browser.requestOrigins(state.pending.origins);
    } catch (error) {
      view.showStatus('error', messageOf(error));
      return Promise.resolve();
    }

    return run(async () => {
      const granted = await permissionRequest;
      if (!granted) {
        view.showStatus(
          'warning',
          '未授予图片读取权限；可改选“保持图片原地址”导出'
        );
        return;
      }

      const { markdown } = state.pending;
      await downloadLocalized(markdown);
      state.pending = undefined;
      view.showPermissionStep([]);
    });
  }

  return {
    initialize,
    viewMarkdown,
    copyMarkdown,
    startExport,
    grantAndContinue
  };
}
