import {
  collectImageOrigins,
  ExportError,
  fetchMarkdownText,
  fetchYuqueDocJson,
  localizeImages
} from './exporter.js';
import { sanitizeFilename } from './filename.js';
import { extractRemoteImageUrls } from './markdown.js';
import {
  convertStructuredDoc,
  hasConvertiblePayload,
  isStructuredDoc
} from './sheet-parse.js';
import { tableToCsv, tableToMarkdown } from './table-format.js';
import { inspectYuqueUrl } from './yuque-url.js';
import { createZip } from './zip.js';

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createPopupController({ browser, view, fetchImpl }) {
  const state = {
    inspection: undefined,
    kind: 'unsupported',
    markdown: undefined,
    pending: undefined,
    tabId: undefined,
    table: undefined,
    tableCsv: undefined,
    tableMarkdown: undefined,
    title: '语雀文档',
    docPayload: undefined,
    structuredKind: undefined
  };

  function renderPage(reason = state.inspection?.reason) {
    view.renderPage({
      supported: state.inspection?.supported === true,
      kind: state.kind,
      title: state.title,
      reason
    });
  }

  function switchToTableMode() {
    state.kind = 'table';
    state.markdown = undefined;
    state.pending = undefined;
    renderPage(undefined);
  }

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
      view.showStatus('error', messageOf(error), error?.details);
      return undefined;
    } finally {
      view.setBusy(false);
    }
  }

  async function loadDocPayload({ allowApiFallback = false } = {}) {
    if (hasConvertiblePayload(state.docPayload)) {
      return state.docPayload;
    }
    if (typeof browser.fetchPageDocument === 'function') {
      try {
        const payload = await browser.fetchPageDocument(state.tabId);
        if (payload) {
          state.docPayload = payload;
        }
      } catch {
        // Page bootstrap fetch is best-effort.
      }
    }
    if (
      allowApiFallback &&
      !hasConvertiblePayload(state.docPayload) &&
      state.inspection?.docApiUrl
    ) {
      try {
        state.docPayload = await fetchYuqueDocJson(
          fetchImpl,
          state.inspection.docApiUrl
        );
      } catch {
        // Keep the page payload if the Open API fallback fails.
      }
    }
    return state.docPayload;
  }

  async function tableFromPayload(payload) {
    if (!hasConvertiblePayload(payload)) {
      return undefined;
    }
    try {
      return await convertStructuredDoc(payload, {
        title: payload.title || state.title,
        sourceUrl: state.inspection.sourceUrl
      });
    } catch (error) {
      if (error?.code === 'EMPTY_SHEET') {
        return undefined;
      }
      throw error;
    }
  }

  async function loadMarkdown() {
    ensureSupported();
    if (state.markdown === undefined) {
      try {
        state.markdown = await fetchMarkdownText(
          fetchImpl,
          state.inspection.markdownUrl
        );
      } catch (error) {
        if (error instanceof ExportError && error.status === 404) {
          const payload = await loadDocPayload({ allowApiFallback: true });
          if (isStructuredDoc(payload)) {
            if (!state.structuredKind) {
              state.structuredKind =
                payload.type === 'Sheet' || payload.format === 'lakesheet'
                  ? 'sheet'
                  : 'table';
            }
            switchToTableMode();
            return undefined;
          }
          const page = await browser.inspectStructuredPage(state.tabId);
          if (page.structured) {
            state.structuredKind = page.kind;
            switchToTableMode();
            return undefined;
          }
        }
        throw error;
      }
    }
    return state.markdown;
  }

  async function loadTable() {
    ensureSupported();
    if (state.table === undefined) {
      const payload = await loadDocPayload({ allowApiFallback: true });
      const fromPayload = await tableFromPayload(payload);
      const preferDom = state.structuredKind === 'table';

      if (fromPayload && !preferDom) {
        view.showCaptureProgress?.(
          `已解析 ${fromPayload.records.length} 条记录，${fromPayload.columns.length} 个字段`
        );
        state.table = fromPayload;
        return state.table;
      }

      try {
        view.showCaptureProgress?.('正在采集表格记录…');
        state.table = await browser.captureStructuredTable(state.tabId);
        view.showCaptureProgress?.(
          `已采集 ${state.table.records.length} 条记录，${state.table.columns.length} 个字段`
        );
      } catch (error) {
        if (fromPayload) {
          view.showCaptureProgress?.(
            `已解析 ${fromPayload.records.length} 条记录，${fromPayload.columns.length} 个字段`
          );
          state.table = fromPayload;
          return state.table;
        }
        if (state.structuredKind === 'sheet' || payload?.type === 'Sheet') {
          throw new Error('无法读取语雀表格数据，请刷新页面后重试');
        }
        throw error;
      }
    }
    return state.table;
  }

  async function loadTableMarkdown() {
    if (state.tableMarkdown === undefined) {
      state.tableMarkdown = tableToMarkdown(await loadTable());
    }
    return state.tableMarkdown;
  }

  async function loadTableCsv() {
    if (state.tableCsv === undefined) {
      state.tableCsv = tableToCsv(await loadTable());
    }
    return state.tableCsv;
  }

  async function loadCopyableMarkdown() {
    if (state.kind === 'table') {
      return loadTableMarkdown();
    }
    const markdown = await loadMarkdown();
    return state.kind === 'table' ? loadTableMarkdown() : markdown;
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
    state.tabId = tab?.id;
    state.title = sanitizeFilename(tab?.title);
    state.inspection = inspectYuqueUrl(tab?.url);
    state.kind = state.inspection.supported ? 'document' : 'unsupported';

    if (state.inspection.supported) {
      try {
        const page = await browser.inspectStructuredPage(state.tabId);
        state.structuredKind = page.kind;
        if (page.structured) {
          state.kind = 'table';
        }
        if (page.kind === 'sheet') {
          await loadDocPayload();
        }
      } catch {
        // A missed inspection can still fall back after a Markdown 404.
      }
    }

    renderPage();
  }

  async function viewMarkdown() {
    return run(async () => {
      ensureSupported();
      if (state.kind === 'table') {
        const markdown = await loadTableMarkdown();
        await browser.openGeneratedMarkdown({
          title: state.title,
          markdown
        });
        view.showStatus('success', '已在新标签页打开生成的 Markdown');
        return;
      }
      await browser.openTab(state.inspection.markdownUrl);
      view.showStatus('success', '已在新标签页打开 Markdown');
    });
  }

  async function copyMarkdown() {
    return run(async () => {
      const markdown = await loadCopyableMarkdown();
      await browser.copyText(markdown);
      view.showStatus('success', 'Markdown 已复制到剪贴板');
    });
  }

  async function startExport(mode) {
    return run(async () => {
      async function exportTable(tableMode) {
        state.pending = undefined;
        view.showPermissionStep([]);

        if (tableMode === 'markdown') {
          const markdown = await loadTableMarkdown();
          await browser.downloadBlob(
            new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
            `${state.title}.md`
          );
          view.showStatus(
            'success',
            `Markdown 已导出：${state.table.records.length} 条记录`
          );
          return;
        }

        if (tableMode === 'csv') {
          const csv = await loadTableCsv();
          await browser.downloadBlob(
            new Blob([csv], { type: 'text/csv;charset=utf-8' }),
            `${state.title}.csv`
          );
          view.showStatus(
            'success',
            `CSV 已导出：${state.table.records.length} 条记录`
          );
          return;
        }

        throw new Error('未知的表格导出模式');
      }

      if (state.kind === 'table') {
        await exportTable(mode);
        return;
      }

      const markdown = await loadMarkdown();
      if (state.kind === 'table') {
        await exportTable(mode === 'csv' ? 'csv' : 'markdown');
        return;
      }

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
