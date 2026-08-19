# Yuque Structured Table Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Chrome extension so a single Yuque Lakex table/kanban can be detected, captured from its rendered table view, and viewed, copied, or downloaded as Markdown or CSV without using Yuque's encrypted private API.

**Architecture:** Keep the v1 Markdown endpoint path unchanged for ordinary documents. For a structured page, the popup injects a small on-demand bridge into the active tab; the bridge dynamically imports a testable page-capture module that switches to the existing table view, walks its virtualized rows, and returns normalized records. Pure formatter modules produce Markdown/CSV, and an ephemeral service-worker handoff opens generated Markdown in a local viewer without persistent storage.

**Tech Stack:** Chrome Extension Manifest V3, browser DOM APIs, JavaScript ES modules, Node.js 20 built-in test runner, no third-party runtime dependencies.

**Spec:** `docs/plans/2026-08-19-yuque-table-export-design.md`

## Global Constraints

- Support only the current single Yuque document/table; do not add knowledge-base batch export.
- Export the existing table view's current filters, groups, and sort order; do not clear or modify filters.
- Do not decrypt private API payloads or read Cookie, Authorization, Token, Local Storage, or browser history.
- Inject capture code only after the user opens the extension on the active Yuque tab.
- Keep all content local, use no external service, and persist no document/table content.
- Fail without producing a file when capture cannot prove it reached the bottom or detects record conflicts.
- Preserve v1 ordinary-document behavior and image localization.
- Use Node.js 20 or newer and add no third-party runtime dependency.

## File Structure

- Modify `lib/exporter.js`: retain HTTP status on `ExportError` for a reliable 404 fallback.
- Create `lib/table-format.js`: pure Markdown and CSV rendering for normalized table data.
- Create `lib/table-capture.js`: pure capture-state merging, conflict detection, and completion rules.
- Create `lib/table-page.js`: DOM inspection, table-view switching, row extraction, virtual scrolling, and restoration.
- Create `content/table-bridge.js`: idempotent message bridge that dynamically imports `lib/table-page.js` on demand.
- Modify `lib/popup-controller.js`: page-kind state machine and ordinary/structured action routing.
- Modify `popup/popup.js`, `popup/popup.html`, `popup/popup.css`: browser adapter and page-kind-specific UI.
- Create `background/service-worker.js`: in-memory one-time Markdown preview handoff.
- Create `viewer/viewer.html`, `viewer/viewer.js`, `viewer/viewer.css`: local plain-text Markdown viewer.
- Modify `manifest.json`: add `scripting`, service worker, and narrowly scoped web-accessible capture modules.
- Modify `README.md`: document v2 use, permissions, privacy, and limits.
- Create/modify tests named in the tasks below.

---

### Task 1: Preserve HTTP Status for Structured-Page Fallback

**Files:**
- Modify: `lib/exporter.js`
- Modify: `tests/exporter.test.js`

**Interfaces:**
- Consumes: existing `fetchMarkdownText(fetchImpl, markdownUrl)`.
- Produces: `new ExportError(code, message, { cause?, status? })` with public `status`; an HTTP 404 remains code `HTTP_ERROR` and has `status === 404`.

- [ ] **Step 1: Write the failing HTTP-status test**

Add a test whose production mutation is “drop the response status before the popup can inspect it”:

```js
test('HTTP 错误保留状态码供结构化页面回退判断', async () => {
  await assert.rejects(
    fetchMarkdownText(
      async () => response('Not Found', { status: 404 }),
      'https://team.yuque.com/a/b/c/markdown'
    ),
    (error) =>
      error instanceof ExportError &&
      error.code === 'HTTP_ERROR' &&
      error.status === 404
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='HTTP 错误保留状态码' tests/exporter.test.js`

Expected: FAIL because `error.status` is `undefined`.

- [ ] **Step 3: Implement status retention**

Update the constructor without changing existing call sites that only pass `cause`:

```js
export class ExportError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ExportError';
    this.code = code;
    this.status = options.status;
  }
}
```

Pass `{ status: response.status }` when `response.ok` is false.

- [ ] **Step 4: Run focused and regression tests and verify GREEN**

Run: `node --test tests/exporter.test.js`

Expected: all exporter tests PASS with no warning.

- [ ] **Step 5: Commit the error-contract change**

```bash
git add lib/exporter.js tests/exporter.test.js
git commit -m "fix: preserve Yuque HTTP status"
```

---

### Task 2: Render Normalized Tables as Markdown and CSV

**Files:**
- Create: `lib/table-format.js`
- Create: `tests/table-format.test.js`

**Interfaces:**
- Consumes normalized data:

```js
{
  title: string,
  sourceUrl: string,
  viewName: string,
  filtersActive: boolean,
  columns: Array<{ id: string, name: string }>,
  records: Array<{
    key: string,
    values: Record<string, string | string[] | { text: string, href: string }>
  }>
}
```

- Produces: `tableToMarkdown(table): string` and `tableToCsv(table): string`.

- [ ] **Step 1: Write failing Markdown tests**

Create literal fixtures and assertions covering title/source metadata, column order, empty values, multi-values, links, and pipe/newline escaping:

```js
test('按字段顺序生成带来源信息的 Markdown 表格', () => {
  assert.equal(
    tableToMarkdown({
      title: '早会表',
      sourceUrl: 'https://team.yuque.com/a/b/c',
      viewName: '表格视图',
      filtersActive: true,
      columns: [
        { id: 'subject', name: '事项' },
        { id: 'status', name: '状态' },
        { id: 'doc', name: '文档' }
      ],
      records: [{
        key: '1',
        values: {
          subject: 'A | B\n下一行',
          status: ['进行中', 'P0'],
          doc: { text: '方案', href: 'https://example.test/doc' }
        }
      }]
    }),
    [
      '# 早会表',
      '',
      '> 来源：https://team.yuque.com/a/b/c',
      '> 导出范围：当前表格视图（保留筛选、分组和排序）',
      '',
      '| 事项 | 状态 | 文档 |',
      '| --- | --- | --- |',
      '| A \\| B<br>下一行 | 进行中、P0 | [方案](https://example.test/doc) |',
      ''
    ].join('\n')
  );
});
```

Add a separate test asserting missing cells become empty table cells rather than shifting later values.

- [ ] **Step 2: Run Markdown tests and verify RED**

Run: `node --test tests/table-format.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/table-format.js`.

- [ ] **Step 3: Implement the minimal Markdown formatter**

Implement and export `tableToMarkdown`. Normalize scalar, array, and link cells; escape backslashes first, then pipes, and replace CR/LF sequences with `<br>`.

- [ ] **Step 4: Run Markdown tests and verify GREEN**

Run: `node --test --test-name-pattern='Markdown|空字段' tests/table-format.test.js`

Expected: Markdown tests PASS.

- [ ] **Step 5: Write failing CSV tests**

Add literal tests whose production mutations are “omit BOM” and “fail to quote commas/quotes/newlines”:

```js
test('生成带 BOM 且符合 RFC 4180 转义规则的 CSV', () => {
  const csv = tableToCsv({
    title: '表',
    sourceUrl: 'https://team.yuque.com/a/b/c',
    viewName: '表格视图',
    filtersActive: false,
    columns: [{ id: 'a', name: '事项' }, { id: 'b', name: '标签' }],
    records: [{ key: '1', values: { a: '含,逗号和"引号"\n换行', b: ['A', 'B'] } }]
  });

  assert.equal(csv, '\uFEFF事项,标签\r\n"含,逗号和""引号""\n换行",A；B\r\n');
});
```

Add a link assertion expecting `方案 <https://example.test/doc>`.

- [ ] **Step 6: Run CSV tests and verify RED**

Run: `node --test --test-name-pattern='CSV|BOM|链接' tests/table-format.test.js`

Expected: FAIL because `tableToCsv` is missing.

- [ ] **Step 7: Implement CSV and run the full formatter tests**

Export `tableToCsv`, apply RFC 4180 quoting, join multi-values with `；`, and terminate every row with `\r\n`.

Run: `node --test tests/table-format.test.js`

Expected: all formatter tests PASS.

- [ ] **Step 8: Commit formatters**

```bash
git add lib/table-format.js tests/table-format.test.js
git commit -m "feat: format Yuque tables as Markdown and CSV"
```

---

### Task 3: Build Capture-State Rules and DOM Table Capture

**Files:**
- Create: `lib/table-capture.js`
- Create: `lib/table-page.js`
- Create: `content/table-bridge.js`
- Create: `tests/table-capture.test.js`
- Create: `tests/table-page.test.js`

**Interfaces:**
- `createCaptureState(columns): { columns, recordsByKey: Map, conflicts: Array }`.
- `mergeRecordBatch(state, records): { added: number, conflicts: number }`.
- `captureCanFinish({ atBottom, stablePasses, conflicts }): boolean`.
- `inspectStructuredPage(doc = document): { structured: boolean, activeView: string | null, hasTableView: boolean }`.
- `captureStructuredTable({ doc = document, locationHref = location.href, onProgress = () => {}, now = Date.now, sleep }): Promise<NormalizedTable>`.
- Bridge message names: `YUQUE_TABLE_INSPECT` and `YUQUE_TABLE_CAPTURE`; responses are `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.

- [ ] **Step 1: Write failing capture-state tests**

Use real Maps and literal batches. Cover new-record insertion, identical duplicate suppression, conflicting duplicate detection, and the three-stable-pass bottom rule:

```js
test('同一记录字段冲突时标记冲突且不静默覆盖', () => {
  const state = createCaptureState([{ id: 'subject', name: '事项' }]);
  mergeRecordBatch(state, [{ key: 'row-1', values: { subject: '原值' } }]);
  const result = mergeRecordBatch(state, [
    { key: 'row-1', values: { subject: '新值' } }
  ]);

  assert.equal(result.conflicts, 1);
  assert.equal(state.recordsByKey.get('row-1').values.subject, '原值');
  assert.equal(captureCanFinish({ atBottom: true, stablePasses: 3, conflicts: 1 }), false);
});
```

- [ ] **Step 2: Run capture-state tests and verify RED**

Run: `node --test tests/table-capture.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement capture-state rules and verify GREEN**

Compare record values using a stable JSON representation that sorts object keys but preserves array order. Never overwrite a conflicting record.

Run: `node --test tests/table-capture.test.js`

Expected: all capture-state tests PASS.

- [ ] **Step 4: Write failing structured-page inspection tests**

Create minimal fake documents whose `querySelectorAll('[role="tab"]')` returns fake elements with `textContent`, `getAttribute('aria-selected')`, and `matches`. Assert ordinary docs are false, table tabs are true, and selected view text is returned.

```js
test('通过页面视图标签识别结构化表格', () => {
  const doc = fakeDocument([
    fakeTab('看板视图', false),
    fakeTab('表格视图', true)
  ]);
  assert.deepEqual(inspectStructuredPage(doc), {
    structured: true,
    activeView: '表格视图',
    hasTableView: true
  });
});
```

- [ ] **Step 5: Run inspection tests and verify RED**

Run: `node --test tests/table-page.test.js`

Expected: FAIL because `lib/table-page.js` is missing.

- [ ] **Step 6: Implement page inspection and verify GREEN**

Normalize tab labels by removing a trailing `remove` control label and whitespace. A page is structured only when at least one normalized label equals `表格视图` or `看板视图` and a `表格视图` tab exists.

Run: `node --test --test-name-pattern='识别|普通文档' tests/table-page.test.js`

Expected: inspection tests PASS.

- [ ] **Step 7: Write failing row-normalization tests**

Export `normalizeRenderedRow({ rowIndex, primaryText, cells }, columns)` from `lib/table-page.js`. Test that:

- a row without numeric/virtual index returns `null` (group and statistics rows are excluded);
- direct child cells preserve empty positions;
- anchors become `{ text, href }`;
- repeated badges in one cell become an ordered string array;
- a primary text plus index creates a stable key.

Use fake cell objects exposing `innerText`, `querySelectorAll('a[href]')`, and `dataset` instead of mocking browser APIs.

- [ ] **Step 8: Run row tests and verify RED**

Run: `node --test --test-name-pattern='行|字段|链接' tests/table-page.test.js`

Expected: FAIL because `normalizeRenderedRow` is missing.

- [ ] **Step 9: Implement row normalization and verify GREEN**

Do not infer positions from a row's compressed `innerText`. Consume one cell object per column and emit an explicit empty string when the matching cell is blank.

Run: `node --test tests/table-page.test.js`

Expected: all page-module unit tests PASS.

- [ ] **Step 10: Implement the minimal DOM capture loop**

In `captureStructuredTable`:

- remember URL, selected view, and discovered scroll positions;
- click the existing `表格视图` tab only when not already selected;
- wait up to 10 seconds for a table and header buttons;
- derive columns from header controls, excluding checkbox/status controls;
- discover the closest descendant or ancestor with `scrollHeight > clientHeight` and `overflow-y` equal to `auto` or `scroll`;
- sample rendered record buttons/rows, normalize and merge;
- advance by `max(1, floor(clientHeight * 0.8))`, wait for two animation frames plus 80 ms, and resample;
- require bottom plus three stable samples, with a 120-second total deadline;
- throw coded errors for missing table, empty columns, no records, timeout, URL change, or conflicts;
- restore original view and scroll offsets in `finally`.

The default `sleep` implementation must be injectable so tests never wait real time.

- [ ] **Step 11: Add the idempotent bridge**

`content/table-bridge.js` sets `globalThis.__YUQUE_TABLE_BRIDGE_INSTALLED__`, registers one `chrome.runtime.onMessage` listener, imports `chrome.runtime.getURL('lib/table-page.js')`, and maps the two message types to the public functions. It returns `true` while sending an asynchronous response.

- [ ] **Step 12: Run capture tests and commit**

Run: `node --test tests/table-capture.test.js tests/table-page.test.js`

Expected: all capture and page tests PASS with no warning.

```bash
git add lib/table-capture.js lib/table-page.js content/table-bridge.js tests/table-capture.test.js tests/table-page.test.js
git commit -m "feat: capture rendered Yuque table records"
```

---

### Task 4: Integrate Structured Mode into the Popup and Local Viewer

**Files:**
- Modify: `lib/popup-controller.js`
- Modify: `popup/popup.js`
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`
- Create: `background/service-worker.js`
- Create: `viewer/viewer.html`
- Create: `viewer/viewer.js`
- Create: `viewer/viewer.css`
- Modify: `tests/popup-controller.test.js`
- Create: `tests/preview-store.test.js`

**Interfaces:**
- Browser adapter adds `inspectStructuredPage(tabId)`, `captureStructuredTable(tabId)`, and `openGeneratedMarkdown({ title, markdown })`.
- View adapter changes `renderPage` input to `{ supported, kind: 'document' | 'table' | 'unsupported', title, reason }` and adds `showCaptureProgress(message)`.
- Popup controller keeps existing public methods and accepts structured export modes `markdown` and `csv` in `startExport`.
- Preview messages: `YUQUE_PREVIEW_CREATE` returns `{ token }`; `YUQUE_PREVIEW_TAKE` returns `{ title, text }` once, then deletes it.

- [ ] **Step 1: Write failing controller initialization tests**

Add tests for:

- proactive table detection renders kind `table` without fetching Markdown;
- ordinary pages render kind `document`;
- a delayed structured page is re-inspected after a Markdown fetch fails with status 404;
- a non-404 failure is still shown unchanged.

Use behavior fakes that record actual view outputs and downloaded blobs; do not assert that a mock merely exists.

- [ ] **Step 2: Run focused controller tests and verify RED**

Run: `node --test --test-name-pattern='结构化|表格|404' tests/popup-controller.test.js`

Expected: FAIL because the controller has no page-kind branch or browser inspection API.

- [ ] **Step 3: Implement page-kind initialization and 404 fallback**

Store the active tab id and `kind` in controller state. Detect structured mode during `initialize`; in `loadMarkdown`, catch only `ExportError` with `status === 404`, re-inspect once, switch mode when detected, and otherwise rethrow.

- [ ] **Step 4: Write failing structured action tests**

Add literal assertions that:

- copy captures once, formats Markdown, and copies generated text;
- repeated view/copy/export actions reuse the cached normalized table while the popup stays open;
- Markdown mode downloads `<title>.md`;
- CSV mode downloads `<title>.csv` with MIME `text/csv;charset=utf-8`;
- normal document image modes remain unchanged;
- capture errors produce an error status and no download.

- [ ] **Step 5: Run structured action tests and verify RED**

Run: `node --test --test-name-pattern='复制表格|CSV|采集失败|缓存' tests/popup-controller.test.js`

Expected: FAIL because structured actions are not implemented.

- [ ] **Step 6: Implement structured action routing and verify GREEN**

Use `tableToMarkdown` and `tableToCsv`. Cache only in popup memory. For structured pages, ignore image localization controls and reject unknown export modes.

Run: `node --test tests/popup-controller.test.js`

Expected: all controller tests PASS, including v1 regressions.

- [ ] **Step 7: Write failing one-time preview-store tests**

Move the preview map logic into exported pure functions in `background/service-worker.js` guarded so importing it under Node does not access `chrome`. Test create/take, one-time deletion, and expired-entry rejection with an injected clock.

```js
test('Markdown 预览只能读取一次', () => {
  const store = createPreviewStore({ now: () => 1000, ttlMs: 60000, createToken: () => 'token-1' });
  assert.equal(store.create({ title: '表', text: '# 表' }), 'token-1');
  assert.deepEqual(store.take('token-1'), { title: '表', text: '# 表' });
  assert.equal(store.take('token-1'), undefined);
});
```

- [ ] **Step 8: Run preview tests and verify RED**

Run: `node --test tests/preview-store.test.js`

Expected: FAIL because the service worker module does not exist.

- [ ] **Step 9: Implement service-worker and viewer handoff**

Use a 60-second TTL and `crypto.randomUUID()` in production. The viewer reads its token from `location.hash`, sends `YUQUE_PREVIEW_TAKE`, renders with `textContent` inside `<pre>`, and shows an expired-preview message when missing. Never use `innerHTML` for document content.

- [ ] **Step 10: Update popup UI and browser adapter**

- Add a hidden structured export fieldset with Markdown/CSV radios.
- Toggle document/table fieldsets from `renderPage`.
- Inject `content/table-bridge.js` with `chrome.scripting.executeScript` before sending inspect/capture messages.
- Add `chrome.runtime.onMessage` progress handling scoped to the active tab id.
- Create preview through the service worker, then open `viewer/viewer.html#<encoded-token>`.
- Preserve all existing normal-document buttons and image-permission behavior.

- [ ] **Step 11: Run UI/controller tests and commit**

Run: `node --test tests/popup-controller.test.js tests/preview-store.test.js`

Expected: all popup and preview tests PASS.

```bash
git add lib/popup-controller.js popup background viewer tests/popup-controller.test.js tests/preview-store.test.js
git commit -m "feat: add structured table export workflow"
```

---

### Task 5: Package, Document, and Verify v2

**Files:**
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `tests/extension-package.test.js`

**Interfaces:**
- Manifest declares `scripting`, `background.service_worker`, and `web_accessible_resources` for only `lib/table-page.js` plus its `lib/table-capture.js` dependency on Yuque origins.
- Package tests load every declared local file and validate version `2.0.0`.

- [ ] **Step 1: Write failing package behavior tests**

Extend the package test to parse the manifest and assert:

- version is `2.0.0`;
- `scripting` is present while broad new non-optional permissions are absent;
- service worker, viewer files, bridge, and page module exist;
- web-accessible resources expose only `lib/table-page.js` and `lib/table-capture.js`, and only to Yuque HTTP(S) match patterns.

The test must read each declared path rather than grep source text.

- [ ] **Step 2: Run package tests and verify RED**

Run: `node --test tests/extension-package.test.js`

Expected: FAIL because the manifest still describes v1.

- [ ] **Step 3: Update manifest and README**

Set version `2.0.0`, describe ordinary and structured export, add `scripting`, register `background/service-worker.js` as a module service worker, and expose only the dynamically imported page module plus its capture-state dependency to Yuque origins. Update README usage, permissions, privacy, v2 behavior, “current table view” semantics, and known DOM-compatibility limitation.

- [ ] **Step 4: Run package and full automated tests**

Run: `npm test`

Expected: all tests PASS with zero failures and no warnings.

- [ ] **Step 5: Run syntax checks for browser-only scripts**

Run:

```bash
node --check content/table-bridge.js
node --check background/service-worker.js
node --check viewer/viewer.js
node --check popup/popup.js
```

Expected: every command exits 0.

- [ ] **Step 6: Perform Chrome manual acceptance**

Reload the unpacked extension from this worktree and verify:

1. an ordinary Yuque document still views, copies, and downloads Markdown;
2. the supplied structured page is detected as table/kanban;
3. starting on its board switches to table, reaches the last rendered record, exports Markdown/CSV, and restores the board;
4. starting on its table preserves the active “1个筛选” result and column order;
5. links, empty fields, personnel, multi-select tags, and dates do not shift columns;
6. forcing a timeout/selector failure shows an error and creates no file.

Record the observed row and column totals in the development handoff without copying private cell contents.

- [ ] **Step 7: Review requirements and diff**

Compare `git diff origin/main...HEAD` against every section of the design spec. Confirm no code reads storage, cookies, authorization headers, browser history, or encrypted API payloads, and no table content is logged.

- [ ] **Step 8: Commit release documentation and package changes**

```bash
git add manifest.json README.md tests/extension-package.test.js
git commit -m "docs: release structured table exporter v2"
```

- [ ] **Step 9: Final clean verification**

Run:

```bash
npm test
git status --short
git log --oneline --decorate -6
```

Expected: all tests PASS, `git status --short` is empty, and the v2 task commits appear above the design and v1 commits.
