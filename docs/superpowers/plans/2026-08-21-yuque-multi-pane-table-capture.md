# Yuque Multi-Pane Table Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor structured-table capture so the extension merges Yuque's independently rendered table panes into verified Markdown/CSV records while keeping the popup fixed at 360px and diagnostics collapsed.

**Architecture:** Keep ordinary-document Markdown export unchanged. Replace the single-`table` capture assumption with a layout pass that discovers all visible tables/grid rows, clusters rows by vertical geometry, maps cells to header intervals, and merges pane samples by stable record identity. Structured capture errors carry short human messages plus an optional anonymous diagnostic payload that the popup exposes only in a collapsed copyable panel.

**Tech Stack:** Chrome Manifest V3, browser DOM/layout APIs (`querySelectorAll`, `getBoundingClientRect`, `getComputedStyle`), JavaScript ES modules, Node.js built-in `node:test`, no third-party runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-20-yuque-multi-pane-table-capture-design.md`

## Global Constraints

- Support only the current single Yuque document/table; do not add knowledge-base batch export.
- Export the existing table view's current filters, groups, and sort order; do not clear or modify filters.
- Do not decrypt private API payloads or read Cookie, Authorization, Token, Local Storage, or browser history.
- Inject capture code only after the user opens the extension on the active Yuque tab.
- Keep all content local, use no external service, and persist no document/table content.
- Fail without producing a file when capture cannot prove row/column alignment, reach the bottom, or resolve stable record identity.
- Preserve v1 ordinary-document behavior and image localization.
- Use Node.js 20 or newer and add no third-party runtime dependency.
- Keep popup width at 360px; long diagnostic text must never determine intrinsic width.

---

### Task 1: Split structured errors from the popup's short status

**Files:**
- Modify: `lib/table-capture.js`
- Modify: `lib/table-page.js`
- Modify: `content/table-bridge.js`
- Modify: `lib/popup-controller.js`
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`
- Modify: `popup/popup.css`
- Modify: `tests/table-page.test.js`
- Modify: `tests/popup-controller.test.js`

**Interfaces:**
- `new TableCaptureError(code, message, details = {})` stores `error.details` without changing `error.code` or `error.message`.
- The bridge returns `{ ok: false, error: { code, message, details } }`.
- `view.showStatus(kind, message, details)` renders only `message` in the status paragraph and stores optional `details.diagnostic` in a collapsed panel.
- The popup exposes `copyDiagnostic()` through a button; it writes only the displayed anonymous diagnostic to the existing clipboard adapter.

- [ ] **Step 1: Write the failing error-details test**

Add to `tests/table-page.test.js`:

```js
test('无记录时错误正文简短且诊断独立传递', async () => {
  const table = fakeTable([
    fakeRow([fakeButton([fakeCell('事项')]), fakeButton([fakeCell('状态')])])
  ]);
  const doc = fakeCaptureDocument(table);

  await assert.rejects(
    captureStructuredTable({ doc, locationHref: doc.location.href, sleep: async () => {}, now: () => 0 }),
    (error) =>
      error.code === 'NO_RECORDS' &&
      error.message === '未读取到可导出的表格记录' &&
      typeof error.details?.diagnostic === 'string'
  );
});
```

Update the fake document so `querySelectorAll('table')` returns the supplied table. The current implementation fails because it appends `诊断：...` to `error.message` and has no `details` property.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='错误正文简短且诊断独立' tests/table-page.test.js`

Expected: FAIL because the message contains the diagnostic string and `error.details` is undefined.

- [ ] **Step 3: Implement the structured error contract**

Change `TableCaptureError` to:

```js
export class TableCaptureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TableCaptureError';
    this.code = code;
    this.details = details;
  }
}
```

Change the no-record branch to `new TableCaptureError('NO_RECORDS', '未读取到可导出的表格记录', { diagnostic: describeDocumentShape(doc) })`. Keep diagnostic generation separate from the capture message.

In `content/table-bridge.js`, serialize `error.details ?? {}`. In `popup/popup.js`, attach `response.error.details` to the thrown `Error` in `sendTableMessage`; in `lib/popup-controller.js`, call `view.showStatus('error', messageOf(error), error.details)` from `run`.

- [ ] **Step 4: Add the collapsed diagnostics UI**

In `popup/popup.html`, replace the single status paragraph area with:

```html
<p id="status" class="status info" role="status" aria-live="polite" hidden></p>
<details id="diagnostic-panel" class="diagnostic" hidden>
  <summary>诊断信息</summary>
  <pre id="diagnostic-text"></pre>
  <button id="diagnostic-copy" class="button button-secondary" type="button">复制诊断信息</button>
</details>
```

`view.showStatus` must set `status.textContent = message`, hide the details panel when no diagnostic is present, and reset the copy button label to `复制诊断信息`. The copy handler uses `navigator.clipboard.writeText(diagnosticText.textContent)` and temporarily changes the button label to `已复制`.

- [ ] **Step 5: Add fixed-width layout rules**

Add these rules to `popup/popup.css`:

```css
body,
.app,
.status,
.diagnostic,
.diagnostic pre {
  min-width: 0;
  max-width: 360px;
}

.status,
.diagnostic pre {
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}

.diagnostic pre {
  max-height: 180px;
  margin: 8px 0;
  overflow: auto;
  font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

Keep `body { width: 360px; }` and set `.app { min-width: 0; }` so the long anonymous payload cannot widen the popup.

- [ ] **Step 6: Test error detail forwarding and run the regression suite**

Extend `createHarness().view.showStatus` in `tests/popup-controller.test.js` to record its third argument. Add a capture error with `{ details: { diagnostic: 'tables=2' } }`, call `startExport('csv')`, and assert the last status is `{ kind: 'error', message: '未读取到可导出的表格记录', details: { diagnostic: 'tables=2' } }`.

Run: `node --test tests/table-page.test.js tests/popup-controller.test.js`

Expected: all focused tests PASS and ordinary export assertions remain unchanged.

- [ ] **Step 7: Commit the error/UI contract**

```bash
git add lib/table-capture.js lib/table-page.js content/table-bridge.js lib/popup-controller.js popup/popup.html popup/popup.js popup/popup.css tests/table-page.test.js tests/popup-controller.test.js
git commit -m "fix: keep table diagnostics collapsed in popup"
```

### Task 2: Build a multi-pane layout model and pure geometry fixtures

**Files:**
- Modify: `lib/table-page.js`
- Modify: `tests/table-page.test.js`

**Interfaces:**
- `discoverTableLayout(doc): { columns, panes, rows, diagnostic }` discovers visible layout without scrolling or mutating the page.
- `clusterRows(rowDescriptors, tolerance = 3): RowBand[]` groups row descriptors whose vertical intervals overlap within the tolerance.
- `cellValueForColumn(rowBand, column): Cell | undefined` chooses the outermost cell whose horizontal center lies inside the column interval.
- `describeDocumentShape(doc): string` reports anonymous table/pane/row shapes and geometry, with no business text.

- [ ] **Step 1: Write the failing geometry tests**

Add literal fake elements with `tagName`, `getAttribute`, `children`, `innerText`, `querySelectorAll`, and `getBoundingClientRect()` returning fixed rectangles. Add tests:

```js
test('独立窗格中同一纵向位置的行合并为一个行带', () => {
  const layout = discoverTableLayout(fakeGridDocument([
    fakePane({ left: 0, top: 0, width: 300, rows: [fakeRowRect(10, 30, '事项 A')] }),
    fakePane({ left: 300, top: 1, width: 280, rows: [fakeRowRect(11, 30, '进行中')] })
  ]));

  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].sources.length, 2);
});

test('行带允许两个像素的窗格偏差但拒绝跨行合并', () => {
  assert.equal(clusterRows([
    { top: 10, bottom: 40, source: {} },
    { top: 12, bottom: 42, source: {} }
  ], 3).length, 1);
  assert.equal(clusterRows([
    { top: 10, bottom: 30, source: {} },
    { top: 34, bottom: 54, source: {} }
  ], 3).length, 2);
});
```

Add a separate test proving a group/header row with no full record coverage is excluded, an empty cell remains empty, and two columns with the same name receive distinct IDs.

- [ ] **Step 2: Run geometry tests and verify RED**

Run: `node --test --test-name-pattern='窗格|行带|跨行' tests/table-page.test.js`

Expected: FAIL because the layout functions are not exported.

- [ ] **Step 3: Implement anonymous shape and layout primitives**

Implement `describeElementShape` without including `innerText`; classify text only as `empty`, `number`, or `text`. `describeDocumentShape` must enumerate all `table`, `[role="grid"]`, and visible `[role="row"]` containers, include bounded samples (`tables`, row counts, tags, roles, geometry), and cap the string at 12,000 characters for clipboard use.

Implement `clusterRows` by sorting descriptors by `top`, then adding a descriptor to the last band when `descriptor.top <= band.bottom + tolerance` and the vertical overlap is positive; otherwise start a new band. Store all sources in document order.

Implement `discoverTableLayout` as a read-only pass:

1. Query all `table, [role="grid"]` roots and all descendants matching `[role="row"], tr`.
2. Keep nodes whose rect has positive width/height and intersects the active viewport.
3. Identify header candidates from the first row in each pane and use their visible text plus horizontal rectangles to create de-duplicated ordered columns.
4. Create row descriptors for non-header rows, excluding rows whose text is empty or only a group label.
5. Return panes, columns, clustered rows, and the anonymous diagnostic string.

- [ ] **Step 4: Verify the pure layout tests**

Run: `node --test --test-name-pattern='窗格|行带|跨行|匿名' tests/table-page.test.js`

Expected: all new geometry tests PASS; existing single-table tests may still exercise the legacy extraction path until Task 3 replaces it.

- [ ] **Step 5: Commit the layout model**

```bash
git add lib/table-page.js tests/table-page.test.js
git commit -m "feat: discover Yuque table panes by geometry"
```

### Task 3: Replace single-table extraction with pane-aligned capture

**Files:**
- Modify: `lib/table-page.js`
- Modify: `lib/table-capture.js`
- Modify: `tests/table-page.test.js`
- Modify: `tests/table-capture.test.js`

**Interfaces:**
- `sampleLayoutRecords(layout, columns): NormalizedRecord[]` samples one visible viewport from all panes and returns records with explicit empty values.
- `mergeRecordBatch` accepts partial records and merges non-empty values for the same stable key; conflicting non-empty values still throw `RECORD_CONFLICT`.
- `captureStructuredTable` uses `discoverTableLayout` and no longer calls `document.querySelector('table')` as its sole source.

- [ ] **Step 1: Write the failing multi-pane record test**

Add a fixture with a fixed primary pane and two field panes. Each pane exposes a row at slightly different `top` values:

```js
test('固定列和独立字段窗格按视觉行合并完整记录', () => {
  const layout = fakeLayout([
    fakeColumn('事项', 0, 280),
    fakeColumn('状态', 280, 420),
    fakeColumn('负责人', 420, 600)
  ], [
    fakeRowBand(10, 40, [fakeCell('事项 A', 10, 0)]),
    fakeRowBand(11, 41, [fakeCell('进行中', 11, 280)]),
    fakeRowBand(9, 39, [fakeCell('李晓萌', 9, 420)])
  ]);

  assert.deepEqual(sampleLayoutRecords(layout, layout.columns), [{
    key: 'row-0',
    values: { 'column-0': '事项 A', 'column-1': '进行中', 'column-2': '李晓萌' }
  }]);
});
```

Add tests for a missing field (the field remains `''`), a repeated primary name with stable `aria-rowindex` values (two records), and repeated primary names without stable identity (throws `UNSTABLE_RECORD_ID`).

- [ ] **Step 2: Run the multi-pane tests and verify RED**

Run: `node --test --test-name-pattern='独立字段窗格|完整记录|UNSTABLE' tests/table-page.test.js`

Expected: FAIL because `sampleLayoutRecords` is not implemented and the current extractor only sees one table.

- [ ] **Step 3: Implement row identity and cell alignment**

For each row band, choose the first source as the primary source. Resolve identity in this order: `aria-rowindex`, `data-row-index`, `data-index`, then `primaryText + groupKey + occurrence`. If the fallback primary text repeats and no stable attribute exists, throw `TableCaptureError('UNSTABLE_RECORD_ID', '无法稳定识别重复记录', { diagnostic })`.

For every column, find the source cell whose rect center is inside `[column.left, column.right]` and whose vertical interval overlaps the row band. Read only the outermost matched cell with the existing link/badge normalization. Initialize every column ID to `''` before filling values.

- [ ] **Step 4: Extend partial-record merging**

Change `recordFingerprint`/`mergeRecordBatch` so a later record with the same key can fill an existing empty value without conflict. A later non-empty value differing from an existing non-empty value remains a conflict. Arrays and link objects compare canonically as before.

Add tests:

```js
test('同一记录跨窗格补齐空字段不算冲突', () => {
  const state = createCaptureState([{ id: 'a' }, { id: 'b' }]);
  mergeRecordBatch(state, [{ key: 'row-1', values: { a: 'A', b: '' } }]);
  assert.deepEqual(mergeRecordBatch(state, [
    { key: 'row-1', values: { a: '', b: 'B' } }
  ]), { added: 0, conflicts: 0 });
  assert.deepEqual(state.recordsByKey.get('row-1').values, { a: 'A', b: 'B' });
});
```

- [ ] **Step 5: Replace the capture loop**

In `captureStructuredTable`:

1. Switch to `表格视图` when needed and wait for `discoverTableLayout(doc)` to report columns and at least one row source.
2. Save all discovered vertical/horizontal scroll positions and reset the primary vertical scroller to the top.
3. On each `sample`, re-run layout discovery and call `sampleLayoutRecords` so recycled DOM nodes are never reused as old records.
4. Use the existing `collectVirtualRecords` deadline and three-stable-pass rule; pass pane synchronization failures and `UNSTABLE_RECORD_ID` through coded `TableCaptureError`s.
5. Advance the primary vertical scroller by `Math.max(1, Math.floor(clientHeight * 0.8))`; if horizontal virtualization is detected, visit each horizontal segment and merge partial fields before advancing vertically.
6. On `NO_RECORDS`, attach `layout.diagnostic` in `details` while keeping the short message.
7. Restore every saved scroll offset and the original view in `finally`.

- [ ] **Step 6: Run capture and merge tests**

Run: `node --test tests/table-capture.test.js tests/table-page.test.js`

Expected: all legacy single-table tests and new multi-pane/partial-merge tests PASS. A fixture with row-band mismatch must fail before any records are returned.

- [ ] **Step 7: Commit the pane capture**

```bash
git add lib/table-page.js lib/table-capture.js tests/table-page.test.js tests/table-capture.test.js
git commit -m "feat: merge Yuque table panes into records"
```

### Task 4: Wire diagnostics through the bridge, update docs, and verify the extension

**Files:**
- Modify: `README.md`
- Modify: `manifest.json` only if the final implementation adds a new module resource
- Modify: `tests/manifest.test.js` if the resource list changes
- Modify: `tests/popup-controller.test.js`
- Modify: `tests/popup-dom.test.js` if a DOM harness is introduced

**Interfaces:**
- Bridge and popup retain existing message names and export modes.
- `TableCaptureError.details.diagnostic` is local-only and never sent outside the current tab/popup.
- Markdown and CSV formatters consume the same normalized table model as before.

- [ ] **Step 1: Add bridge/controller regression coverage**

Use a bridge response fixture with `{ ok: false, error: { code: 'NO_RECORDS', message: '未读取到可导出的表格记录', details: { diagnostic: 'tables=3' } } }` and assert the popup controller forwards the short message and details separately. Assert a normal HTTP error with no details does not render the diagnostic panel.

- [ ] **Step 2: Update README limitations and troubleshooting**

Document that structured pages are rendered from all visible table panes, that export stops when row/column alignment cannot be proven, that the popup diagnostic is anonymous and local, and that the user must reload the unpacked extension after source changes.

- [ ] **Step 3: Run the full automated verification**

Run:

```bash
npm test
node --check lib/table-page.js
node --check lib/table-capture.js
node --check content/table-bridge.js
node --check popup/popup.js
node --check background/service-worker.js
git diff --check
```

Expected: 0 test failures, 0 syntax errors, and no whitespace errors.

- [ ] **Step 4: Perform manual Chrome acceptance**

Reload the unpacked extension, refresh the target Yuque page, and verify:

1. The popup remains 360px wide after a failed export.
2. A failure shows only the short message; diagnostic details are collapsed and copyable.
3. The target table exports Markdown and CSV with the same visible field order and record count.
4. Empty fields, multi-select values, people, and links do not shift columns.
5. Export from board view returns to the original view and scroll position.
6. Ordinary document export still opens/copies/downloads Markdown.

- [ ] **Step 5: Commit documentation and final verification**

```bash
git add README.md manifest.json tests
git commit -m "docs: document multi-pane table capture limits"
```

