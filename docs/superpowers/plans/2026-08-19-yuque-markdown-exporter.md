# 语雀 Markdown 导出器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可通过 Chrome“加载已解压的扩展程序”安装的 Manifest V3 扩展，支持当前单篇语雀文档的 Markdown 查看、复制、直接导出和图片本地化 ZIP 导出。

**Architecture:** 弹窗只负责浏览器交互，URL、Markdown 图片处理、文件名、导出编排和 ZIP 生成分别放在可由 Node 直接测试的 ESM 模块中。扩展页面使用固定语雀主机权限读取 Markdown，使用运行时可选主机权限读取实际图片域名，不使用服务端和第三方运行时依赖。

**Tech Stack:** Chrome Extensions Manifest V3、原生 JavaScript ESM、HTML/CSS、Node.js 内置 `node:test`、无第三方运行时依赖。

**Spec:** `docs/superpowers/specs/2026-08-19-yuque-markdown-exporter-design.md`

## Global Constraints

- 首版只处理当前打开的单篇文档，不支持知识库批量导出。
- Markdown URL 固定使用 `/markdown?plain=true&linebreak=false&anchor=false`。
- 文档和图片只在浏览器本地处理，不发送到第三方服务，也不持久化。
- 图片本地化使用运行时可选主机权限；权限请求必须由用户点击直接触发。
- 不使用远程代码、构建步骤或第三方运行时依赖。
- 图片部分失败时仍生成 ZIP，并保留失败图片的原始 URL。
- 所有生产逻辑先写失败测试，再写最小实现。

---

### Task 1: 工程骨架、URL 与文件名规则

**Files:**
- Create: `package.json`
- Create: `tests/yuque-url.test.js`
- Create: `tests/filename.test.js`
- Create: `lib/yuque-url.js`
- Create: `lib/filename.js`

**Interfaces:**
- Produces: `inspectYuqueUrl(rawUrl): { supported: boolean, reason?: string, sourceUrl?: string, markdownUrl?: string }`
- Produces: `sanitizeFilename(title, fallback?): string`
- Produces: `inferImageExtension(contentType, rawUrl): string`

- [ ] **Step 1: 添加测试入口和 URL 失败测试**

创建 `package.json`，声明 `"type": "module"` 和 `"test": "node --test"`。创建 `tests/yuque-url.test.js`，用手写字面量断言：企业子域名文档转换为规范 Markdown URL；已有 `/markdown` 不重复追加；非语雀域名、登录页、路径不足和非法 URL 返回 `supported: false`。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectYuqueUrl } from '../lib/yuque-url.js';

test('企业语雀文档转换为 plain Markdown 地址', () => {
  assert.deepEqual(inspectYuqueUrl('https://team.yuque.com/org/repo/doc?x=1#part'), {
    supported: true,
    sourceUrl: 'https://team.yuque.com/org/repo/doc',
    markdownUrl: 'https://team.yuque.com/org/repo/doc/markdown?plain=true&linebreak=false&anchor=false'
  });
});
```

- [ ] **Step 2: 运行 URL 测试并确认因模块缺失而失败**

Run: `npm test -- tests/yuque-url.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `lib/yuque-url.js`。

- [ ] **Step 3: 实现最小 URL 识别模块**

实现明确的系统路径黑名单、主机名边界检查、路径规范化和固定查询参数。不要通过字符串 `includes('yuque.com')` 判断主机名。

```js
export function inspectYuqueUrl(rawUrl) {
  // URL 解析失败或规则不满足时返回带 reason 的不支持结果；
  // 成功时只保留 origin 和规范化 pathname。
}
```

- [ ] **Step 4: 运行 URL 测试并确认通过**

Run: `npm test -- tests/yuque-url.test.js`

Expected: PASS。

- [ ] **Step 5: 添加文件名和扩展名失败测试**

创建 `tests/filename.test.js`，覆盖 Windows/macOS 非法字符、空白或点组成的标题、保留名称、长度上限，以及 Content-Type、URL 后缀和 `.bin` 回退优先级。

```js
test('文件名移除跨平台非法字符', () => {
  assert.equal(sanitizeFilename('  需求:/\\*?"<>|  '), '需求');
});

test('Content-Type 优先决定图片扩展名', () => {
  assert.equal(inferImageExtension('image/jpeg; charset=binary', 'https://x.test/a.png'), '.jpg');
});
```

- [ ] **Step 6: 运行文件名测试并确认因模块缺失而失败**

Run: `npm test -- tests/filename.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `lib/filename.js`。

- [ ] **Step 7: 实现文件名与图片扩展名函数**

文件名清理后最长 120 个 Unicode 字符，空结果回退为 `语雀文档`；图片 MIME 映射至少包含 PNG、JPEG、GIF、WebP、SVG，URL 后缀只接受常见安全图片扩展名。

- [ ] **Step 8: 运行 Task 1 全部测试**

Run: `npm test`

Expected: 全部 PASS，无警告。

- [ ] **Step 9: 提交 Task 1**

```bash
git add package.json tests/yuque-url.test.js tests/filename.test.js lib/yuque-url.js lib/filename.js
git commit -m "feat: add Yuque URL and filename rules"
```

### Task 2: Markdown 图片发现与安全改写

**Files:**
- Create: `tests/markdown.test.js`
- Create: `lib/markdown.js`

**Interfaces:**
- Produces: `extractRemoteImageUrls(markdown): string[]`
- Produces: `rewriteRemoteImageUrls(markdown, replacements: Map<string, string>): string`
- Consumes: 仅处理绝对 `http:`/`https:` 图片 URL。

- [ ] **Step 1: 写图片发现和改写的失败测试**

覆盖普通 Markdown 图片、带尖括号和 title 的 Markdown 图片、双引号/单引号 HTML `<img>`、重复 URL 去重、链接中的普通图片文字、`data:` 和相对路径不处理，以及只改写 replacements 中存在的 URL。

```js
test('按首次出现顺序提取并去重远程图片', () => {
  const source = '![a](https://img.test/a.png)\n<img src="https://img.test/b.jpg">\n![again](https://img.test/a.png)';
  assert.deepEqual(extractRemoteImageUrls(source), [
    'https://img.test/a.png',
    'https://img.test/b.jpg'
  ]);
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `npm test -- tests/markdown.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `lib/markdown.js`。

- [ ] **Step 3: 实现单次扫描和精确 URL 改写**

将 Markdown 和 HTML 图片匹配集中在内部扫描函数中，回调只替换 URL 子串，保留 alt、title、引号和其他属性原样。对实体编码或复杂 HTML 不做 DOM 解析。

- [ ] **Step 4: 运行 Markdown 测试并确认通过**

Run: `npm test -- tests/markdown.test.js`

Expected: PASS。

- [ ] **Step 5: 提交 Task 2**

```bash
git add tests/markdown.test.js lib/markdown.js
git commit -m "feat: parse and rewrite Markdown images"
```

### Task 3: Markdown 获取与图片本地化编排

**Files:**
- Create: `tests/exporter.test.js`
- Create: `lib/exporter.js`

**Interfaces:**
- Consumes: `extractRemoteImageUrls`, `rewriteRemoteImageUrls`, `inferImageExtension`
- Produces: `fetchMarkdownText(fetchImpl, markdownUrl): Promise<string>`
- Produces: `collectImageOrigins(urls): string[]`
- Produces: `localizeImages(markdown, fetchImpl): Promise<{ markdown: string, images: Array<{ name: string, data: Uint8Array }>, succeeded: number, failed: Array<{ url: string, message: string }> }>`
- Produces: `ExportError` with stable `code` values for UI mapping.

- [ ] **Step 1: 写 Markdown 响应校验失败测试**

使用实现完整 `ok/status/url/headers/text` 边界的本地 fake response，覆盖成功文本、HTTP 非成功、HTML 登录响应和空响应。断言用户可识别的错误 code，而不是 fetch fake 的调用次数。

- [ ] **Step 2: 运行响应测试并确认失败**

Run: `npm test -- tests/exporter.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `lib/exporter.js`。

- [ ] **Step 3: 实现 `ExportError` 和 `fetchMarkdownText`**

使用 `credentials: 'include'` 与 `cache: 'no-store'`；HTTP 错误为 `HTTP_ERROR`，HTML 为 `AUTH_REQUIRED`，空文本为 `EMPTY_MARKDOWN`，底层网络异常包装为 `NETWORK_ERROR`。

- [ ] **Step 4: 运行响应测试并确认通过**

Run: `npm test -- tests/exporter.test.js`

Expected: 当前响应测试 PASS。

- [ ] **Step 5: 添加来源收集和本地化部分失败测试**

用真实 `Response`/`Uint8Array` 数据测试：来源按首次出现去重；成功图片获得 `images/image-001.png`；第二张失败时原 URL 保留；同 URL 只生成一个文件；返回准确 succeeded/failed 汇总。

- [ ] **Step 6: 运行新增测试并确认因函数未实现而失败**

Run: `npm test -- tests/exporter.test.js`

Expected: FAIL，指出 `collectImageOrigins` 或 `localizeImages` 缺失/结果不符。

- [ ] **Step 7: 实现来源收集和图片本地化**

图片下载使用 `Promise.allSettled` 保证单图失败不取消其他图片；响应非成功视为失败；结果按文档首次出现顺序命名和输出，不受网络完成顺序影响。

- [ ] **Step 8: 运行 Task 3 测试并确认通过**

Run: `npm test`

Expected: 全部 PASS，无未处理 Promise rejection。

- [ ] **Step 9: 提交 Task 3**

```bash
git add tests/exporter.test.js lib/exporter.js
git commit -m "feat: fetch and localize Yuque Markdown"
```

### Task 4: 无依赖 ZIP 生成器

**Files:**
- Create: `tests/zip.test.js`
- Create: `lib/zip.js`

**Interfaces:**
- Produces: `createZip(entries: Array<{ name: string, data: string | Uint8Array }>): Uint8Array`
- ZIP entries use the store method (compression method 0), UTF-8 flag, CRC-32, local headers, central directory and EOCD.

- [ ] **Step 1: 写 ZIP 行为失败测试**

测试空 entries 拒绝、两个文件的文件名和内容可由测试内独立的最小 ZIP 读取器读回、中文 Markdown 文件名使用 UTF-8、CRC 字段与手算固定 fixture 一致。测试读取器不得调用生产 ZIP 辅助函数。

```js
test('生成的 ZIP 可读回 Markdown 和二进制图片', () => {
  const zip = createZip([
    { name: '文档.md', data: '# 标题' },
    { name: 'images/image-001.png', data: new Uint8Array([1, 2, 3]) }
  ]);
  assert.deepEqual(readStoredZip(zip), new Map([
    ['文档.md', new TextEncoder().encode('# 标题')],
    ['images/image-001.png', new Uint8Array([1, 2, 3])]
  ]));
});
```

- [ ] **Step 2: 运行 ZIP 测试并确认因模块缺失而失败**

Run: `npm test -- tests/zip.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `lib/zip.js`。

- [ ] **Step 3: 实现最小 stored ZIP 写入器**

使用 `DataView` 明确写入 little-endian 字段；文本统一 UTF-8 编码；拒绝空列表、重复/空文件名、单项超过 4 GiB 和 ZIP32 偏移溢出。不得使用 Node 专属 API。

- [ ] **Step 4: 运行 ZIP 与全套测试**

Run: `npm test`

Expected: 全部 PASS。

- [ ] **Step 5: 提交 Task 4**

```bash
git add tests/zip.test.js lib/zip.js
git commit -m "feat: generate dependency-free ZIP exports"
```

### Task 5: Chrome 弹窗、权限工作流与文档

**Files:**
- Create: `tests/popup-controller.test.js`
- Create: `tests/extension-package.test.js`
- Create: `lib/popup-controller.js`
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`
- Create: `manifest.json`
- Create: `README.md`

**Interfaces:**
- Consumes: `inspectYuqueUrl`, `fetchMarkdownText`, `collectImageOrigins`, `localizeImages`, `createZip`, `sanitizeFilename`
- Produces: `createPopupController(dependencies)` with `initialize()`, `viewMarkdown()`, `copyMarkdown()`, `startExport(mode)`, `grantAndContinue()`.
- Browser adapter contract: `getActiveTab`, `openTab`, `copyText`, `requestOrigins`, `downloadBlob`.
- View contract: `renderPage`, `setBusy`, `showStatus`, `showPermissionStep`.

- [ ] **Step 1: 写控制器状态流失败测试**

用内存 view 和边界 fake 测试可观察结果：非文档初始化禁用操作；查看 Markdown 打开规范地址；复制成功显示结果；直接导出下载 `.md`；本地化首次点击显示待授权域名；`grantAndContinue` 拒绝时提示；允许时下载包含 Markdown 与成功图片的 ZIP；任一异常后 busy 状态恢复。

- [ ] **Step 2: 运行控制器测试并确认失败**

Run: `npm test -- tests/popup-controller.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `lib/popup-controller.js`。

- [ ] **Step 3: 实现依赖注入的弹窗控制器**

控制器缓存当前 tab、URL 检查结果、已获取 Markdown 和待授权 origins；只让 `grantAndContinue()` 调用 `requestOrigins()`，确保调用发生在第二次按钮点击的同步处理链上。控制器不直接访问 DOM 或全局 `chrome`。

- [ ] **Step 4: 运行控制器测试并确认通过**

Run: `npm test -- tests/popup-controller.test.js`

Expected: PASS。

- [ ] **Step 5: 写扩展包完整性失败测试**

测试读取并解析真实 `manifest.json`，断言 Manifest V3、`action.default_popup` 指向存在文件、固定权限仅覆盖语雀和必要 API、可选主机权限包含 HTTP(S) 运行时模式；解析 `popup.html` 的本地脚本/样式引用并确认文件存在。

- [ ] **Step 6: 运行包测试并确认因文件缺失而失败**

Run: `npm test -- tests/extension-package.test.js`

Expected: FAIL，错误包含缺失的 `manifest.json`。

- [ ] **Step 7: 实现 Manifest、弹窗与浏览器适配器**

`popup.html` 使用固定 DOM 节点和中文文案；`popup.css` 提供约 360px 宽的清晰状态卡片；`popup.js` 只做 DOM/chrome adapter、控制器装配和事件绑定。所有服务端文本仅写入 `textContent`，禁止 `innerHTML`。下载使用 Blob URL，点击隐藏 `<a download>` 后立即清理节点并延迟 revoke。

Manifest 的核心结构为：

```json
{
  "manifest_version": 3,
  "name": "语雀 Markdown 导出器",
  "version": "1.0.0",
  "permissions": ["activeTab", "clipboardWrite"],
  "host_permissions": ["https://yuque.com/*", "https://*.yuque.com/*"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "action": { "default_popup": "popup/popup.html" }
}
```

- [ ] **Step 8: 编写安装、使用、权限与限制说明**

README 必须包含 Chrome 加载步骤、四个功能入口、两种导出模式、图片权限原因、部分失败行为、隐私声明、运行测试命令和首版非目标。

- [ ] **Step 9: 运行全套自动化验证**

Run: `npm test`

Expected: 全部 PASS，无警告。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 10: 在 Chrome 做手工验收**

通过“加载已解压的扩展程序”加载仓库目录，依次验证普通网页禁用、企业语雀查看、复制、直接 `.md` 导出、本地图片 ZIP、拒绝权限和部分图片失败。若当前环境没有可用的已登录 Chrome 会话，则记录为需用户执行的唯一剩余验收项，不宣称已手工通过。

- [ ] **Step 11: 提交 Task 5**

```bash
git add manifest.json popup lib/popup-controller.js tests/popup-controller.test.js tests/extension-package.test.js README.md
git commit -m "feat: add Chrome popup export workflow"
```
