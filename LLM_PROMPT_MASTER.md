# LLM\_PROMPT\_MASTER.md

> Master context for the modular **LeetCode → Markdown & Jupyter Notebook** userscript.
> Feed this file to the LLM whenever it edits or adds modules in this repo.

---

## 0) Purpose, scope, guarantees

**Goal:** From any LeetCode problem page, produce:

* A polished **Markdown report** (problem description, inline images, glossary, hints, testcases, code captures, submissions table).
* A runnable **Jupyter Notebook** with a shared **test harness** and optional **reference solution** from latest Accepted Python submission.
* A **toolbar** with *Copy Report*, *Copy Log*, *Save .ipynb*.
* **Fast popup glossary**: open each inline term, stabilize content, convert to Markdown, inject anchors.

**Non-goals:** solving problems, uploading data to third-party services, persisting data beyond session except where explicitly stored.

**Principles:**

* **SPA-safe**: single-install guard; robust `locationchange` handling.
* **Fail soft**: degraded paths still produce useful output; never block UI on noncritical failures.
* **Security**: All page code runs in page context only when needed (Monaco dump, network tap); cross-origin fetches use GM XHR.
* **Portability**: Tampermonkey/Violentmonkey (GM grants), modern Chromium/Firefox.

---

## 1) Runtime environment

* **Userscript**: `@run-at document-start`, `@connect *`
* **Grants**: `GM_xmlhttpRequest`, `GM_download`, `GM_setClipboard`, `unsafeWindow`
* **SPA guard flag**: `__LC_MD_INSTALLED__` on `unsafeWindow` (fallback `window`)

---

## 2) Namespace & wiring

* Global root: `window.LCMD`
* Module pattern: IIFE that calls `NS.defineNS('path')` from `src/namespace.js`, then attaches exports.
* No global pollution beyond `window.LCMD`.

---

## 3) High-level flow (pipeline)

1. **Guard**: Ensure single install (SPA).
2. **Network Tap**: Inject a small page-context script to hook `window.fetch` POSTs to interesting endpoints; capture:

   * `customInput` (custom run blob),
   * `typedCode` & `lang` (from submits/interprets),
   * emit `window` event `lc-input-v2`.
   * Store per-slug in `sessionStorage` under `lc_capture_store_v2`.
3. **Glossary (fast)**: On demand, find glossary buttons in problem description, open nearest popover quickly, wait for meaningful & stable HTML, convert to Markdown, close. Build anchors and glossary section.
4. **Fetch problem** via GraphQL (multiple query variants fall back).
5. **Fetch submissions list** (paged) via GraphQL; for each, **details** via GraphQL; if missing metrics, **fallback** to REST `/submissions/detail/{id}/check/`.
6. **Monaco capture**: request top-window editor; fallback to same-origin iframes; final fallback via `unsafeWindow.monaco`.
7. **LocalStorage heuristic**: find plausible code blobs by keys/slugs and code-like content.
8. **HTML→MD**: Convert description to Markdown, inline images to Data URLs (GM XHR if possible).
9. **Assemble report** sections: header, description, hints, testcases (default+captured), editor code blocks, localStorage code block, submissions table, per-submission code blocks.
10. **Notebook**: Build nbformat v4 object; first MD cell (report), harness cell, optional reference cell, current editor/localStorage cells, then per-submission cells. Save via Data URL/GM\_download.
11. **Toolbar UI**: buttons hook to pipeline; toast notifications; capture badge state.
12. **Logging**: lines aggregated when *Copy Log* is used.

---

## 4) Module inventory

### Core

#### `src/namespace.js`

* Exposes `LCMD.defineNS(path: string) -> object` to safely create/return subnamespaces.
* Must be loaded before all modules.

#### `src/config.js`

Config knobs (defaults shown; feel free to tune):

```js
{
  MAX_SUBMISSIONS: 60,
  PAGE_SIZE: 20,
  BETWEEN_DETAIL_MS: 160,
  INCLUDE_LANG_IN_MD: true,
  CLIP_NOTES_CHARS: 180,
  WAIT_MONACO_MS: 9000,
  CODE_BLOCK_COLLAPSE: false,

  INLINE_IMAGES: true,
  IMAGE_TIMEOUT_MS: 20000,

  MONACO_TRACE: true,
  STORAGE_TRACE: true,
  FALLBACK_TRACE: true,
  IFRAMES_TRACE: true,

  CONTENT_READY: {
    MIN_CHARS: 40,
    STABLE_SAMPLES: 3,
    STABLE_GAP_MS: 80,
    TIMEOUT_MS: 1200,
    SEMANTIC_SEL: 'p, ul, ol, li, pre, code, table, strong, em, h1,h2,h3,h4,h5,h6'
  },

  GLOSSARY: {
    HOVER_CLICK_WAIT_MS: 80,
    CLOSE_WAIT_MS: 80,
    PROXIMITY_PX: 500,
    MAX_TERMS: 50,
    OPEN_TIMEOUT_MS: 500
  }
}
```

#### `src/log.js`

* Lightweight logger bound to `LCMD.core.log` with `debug/info/warn/error`.
* Aggregates lines in “log mode” (when user clicks **Copy Log**).

---

### DOM

#### `src/dom/ready.js`

* `onReady(fn)` – DOMContentLoaded helper.
* `ensureSingleInit(key, scope?)` – SPA guard; defaults to `unsafeWindow` then `window`.

#### `src/dom/selectors.js`

* `descriptionRoot()` – locate problem description container.
* `popupCandidates()` – collect likely popover roots (Radix, role=dialog/tooltip, data-state=open).
* Helpers: `isElVisible(el)`, `nearestOpenPopup(button, radiusPx)`.

---

### Utilities (final set)

#### `src/util/string.js`

* **Exports:** `nonEmpty`, `clip`, `sanitizeCodeForMarkdown`, `commentOutsideFences`, `escapeRegExp`, `normalizeWhitespace`, `lines`, `indent`, `stripMarkdown`, `slugify`
* Note: Old `j()` is now `util/json.tryStringify` (or `stableStringify`).

#### `src/util/parse.js`

* **Exports:** `parseRuntimeMs`, `parseMemoryMB`, `coerceNum`, `fmtPct`
* Alias: `LCMD.util.parse === LCMD.util.num`

#### `src/util/time.js`

* **Exports:** `toLocalStringFromEpochSec`, `sleep`, `nowMs`, `formatDurationMs`, `debounce`, `throttle`

#### `src/util/url.js`

* **Exports:** `absolute`, `getCookie`, `join`, `isHttpUrl`
* Compat: `makeAbsoluteUrl` aliases `absolute`.

#### `src/util/guards.js`

* **Exports:** `ensureSingleInit(key)`, `isSameOriginFrame(iframeEl)`, `listSameOriginFrames(root?)`
* Compat: `singleInstall` aliases `ensureSingleInit`.

#### Additional utils

* `src/util/langmap.js`: `labelFromMonacoId`, `fenceFromLabelOrId`, `normalizeFence`, `normalizeFenceFromLabel`, `KNOWN`
* `src/util/json.js`: `safeParse`, `tryStringify`, `stableStringify`, `deepClone`
* `src/util/array.js`: `uniqueBy`, `flatten`, `chunk`, `zip`
* `src/util/object.js`: `pick`, `omit`, `merge`, `get`, `set`
* `src/util/promise.js`: `deferred`, `withTimeout`, `retry`

---

### Network & Images

#### `src/net/gm_xhr.js`

* **Purpose:** Promise-based wrapper over `GM_xmlhttpRequest` with fetch fallback.
* **Exports (LCMD.net.gm):**

  * `isAvailable()`
  * `absoluteUrl(u, base?)`
  * `getCookie(name)`
  * `request(opts)`, `get(url, opts)`, `post(url, body, opts)`
  * `json(url, init?)`
  * `fetchAsDataURL(url, timeoutMs=20000)` → `{ ok, dataUrl, mime, size, error? }`
* **Notes:** Prefer GM for cross-origin; fetch fallback for same-origin or GM failure.

#### `src/net/images.js`

* **Purpose:** Convert `<img>` to embedded Data URLs for offline Markdown.
* **Exports (LCMD.net.images):**

  * `isDataUrl(u)`, `absoluteUrl(u, base?)`
  * `embedOne(imgEl, opts?)`
  * `embedInDom(root, opts?)` → `{ stats, details }`
  * `embedInHtml(html, opts?)` → `{ html, stats, details }`
* **Opts:** `timeoutMs`, `srcAttrs`, `annotateAlt`, `markAttr`, `altDataKey`, `srcDataKey`.

#### `src/net/network_tap.js`

* **Purpose:** Page-context fetch interceptor to capture:

  * Custom input blob (`input`, `testCase`, `testcase`, `data_input`, `customInput`)
  * Typed code (`typed_code`/`code`)
  * Language (`lang`/`language`/`langSlug`)
* Emits `window` event: `lc-input-v2` with `{ customInput, typedCode, lang }`.
* Storage: `sessionStorage['lc_capture_store_v2']` keyed by slug:
  `{ [slug]: { custom:{value,when}, typed:{value,lang,when} } }`

---

### Monaco capture

#### `src/monaco_top.js`

* In top window, respond to `document` event `lc-monaco-request-top` and dispatch `lc-monaco-dump-top` with `{code, langId, __info}`.
* Editor selection: focused → visible → first → largest model.
* Visibility check via `getBoundingClientRect`.

#### `src/monaco_frames.js`

* Injects a bridge into same-origin iframes.
* Parent `postMessage` `{type:'lc-monaco-request', id}`; frame replies with `{type:'lc-monaco-dump', id, data:{code, langId, __info}}`.
* Picks first non-empty code; times out gracefully.

---

### Heuristics

#### `src/storage_scan.js`

* **Goal:** Mine `localStorage` for plausible code snippets tied to current problem:

  * Heuristics: “looks like code”, presence of `class Solution`, function name sniffing from problem `codeSnippets` or `meta`.
* **Export:** `scanLocalStorageHeuristic(slug, question)` → `{ ok, code, meta:{ key?, matchSlug?, seemsForThis?, error? } }`
* Used to display alternative “current code” and as a notebook cell (non-Python prints source).

---

### LeetCode API

#### `src/lc_api/graphql.js`

* **Endpoints:** `${location.origin}/graphql` (try both with/without trailing slash).
* **CSRF:** Read `csrftoken` / `csrftoken_v2` via cookies; send as `x-csrftoken`.
* **Queries:** Provide **variants** to adapt to different site schemas.

  * `questionData(titleSlug)` → `{ questionId,title,titleSlug,content,difficulty,stats,exampleTestcases,sampleTestCase,metaData,codeSnippets[],topicTags[],similarQuestions }`

    * Parse `stats`/`metaData`/`similarQuestions` JSON safely.
  * `qHints(titleSlug)` → `hints | hintList | hintsWithId[]`
  * `submissionList(offset,limit,questionSlug)` → `submissions{id,statusDisplay,lang?,timestamp} hasNext lastKey`
  * `submissionDetails(id)` variants for `{ code, runtime*, memory*, runtimePercentile, memoryPercentile, lang{name}, notes }`
* **Error policy:** try variants in order; surface last error if all fail.

#### `src/lc_api/rest_check.js`

* **Endpoint:** `${origin}/submissions/detail/{id}/check/`
* **Return:** JSON with `state`, `runtime_percentile|runtimePercentile`, `memory_percentile|memoryPercentile`, `status_runtime|runtimeDisplay`, `status_memory|memoryDisplay`.
* **Usage:** Fallback when GraphQL `submissionDetails` lacks metrics.

---

### Markdown & Glossary

#### `src/md/html_to_md.js`

* **Purpose:** Robust HTML→Markdown including:

  * Headings, lists, tables, blockquotes, code blocks (keep language), inline code.
  * Preserves `sup`/`sub` as `^`/`_`.
  * Inlines images via `LCMD.net.images.embedInHtml`.
  * Skips mutation of content inside fenced blocks; smart whitespace joining.
* **Glossary integration:** If `pairs` aren’t passed, it calls the live popup capture to build `pairs`. Injects `[term](#glossary-<label>)` once per pair outside code fences; appends a `## Glossary` section with anchors.

#### `src/md/glossary_markdown.js`

* **Purpose:** Fast popup workflow:

  * Find term buttons in description.
  * Open quickly (hover/click), locate nearest open popup, wait for **meaningful** & **stable** content (`CONTENT_READY.*`), grab HTML, close.
  * Convert popup HTML → Markdown (links, code, lists, headings).
  * Build `{ term, label, md, method, htmlLen, mdLen }[]` pairs and anchor labels.
* **Exports:** `captureGlossaryFromLiveDescription()`, `popupHtmlToMarkdown(html)`, helpers (`isMeaningfulPopup`, `waitForContentReady`, etc.).

#### `src/md/report_build.js`

* **Assemble sections** in this order:

  1. Header (id/title/difficulty/topics/similar/status)
  2. Description (with inline images) ± glossary stats note
  3. Hints (if any)
  4. Testcases: default (from `exampleTestcases`/`sampleTestCase`) and captured (from Network Tap). Smart splitting with optional leading T count.
  5. **Current Editor** (Monaco) code block.
  6. **LocalStorage** heuristic code block.
  7. Submissions table (with metrics & notes).
  8. Per-submission code sections (collapsible optional).

---

### Notebook

#### `src/nb/cells.js`

* **Exports** builders for:

  * `nbSkeleton()` – nbformat v4 base.
  * `mdCell(md)`, `pyCell(code)`
  * `buildHarnessCell(varNames, uniqCases)` – shared test runner (`run_all_cases(Solution)`).
  * `buildReferenceCellIfAny(rows, detailsById)` – only if latest Accepted is Python; otherwise explanatory cell.
  * `monacoCell(monacoEditor)` – Python executes, others display source.
  * `localStorageCell(storageScan)` – same rule: Python executes, else prints.
  * `submissionCell(row, detailsById)` – each submission; Python executes, else prints.

#### `src/nb/notebook_build.js`

* **Export:** `buildNotebook(q, solved, descMd, hints, varNames, defaultBlob, capturedBlob, subsRows, detailsById, monacoEditor, storageScan)` → `{ notebook, filename }`
* First MD cell includes summary/report, harness/ref/editor/localStorage/submission cells follow.

---

### UI

#### `src/ui/toolbar.js`

* Injects fixed bar with buttons: **Copy Report**, **Save .ipynb**, **Copy Log**.
* Toast component (fixed bottom-right).
* Capture badge: indicates custom input capture state for current slug.

#### `src/ui/popup_glossary.js`

* Optional UI hooks for glossary capture diagnostics (logging, counters), integrated with `md/glossary_markdown`.

---

### Orchestration

#### `src/pipeline.js`

* **Public**: `bootstrap()` (or `init/start/run`—bootstrap wires them).
* **Steps (summarized):**

  * Derive `slug` from URL.
  * Kick off `fetchQuestion`, `fetchSubmissionsForSlug`, `fetchHints` in parallel.
  * **Glossary first** (to show popups immediately).
  * Await question/submissions/hints; walk submissions: details via GraphQL, then REST fallback; accumulate `rows` and `detailsById`.
  * Capture Monaco editor; localStorage scan; comment outside fences for storage code.
  * Build description MD (with `pairs`), default testcases blob; variable names via `q.meta`/desc sniff/fallback; mark solved if any Accepted.
  * If user clicked **Copy Report**: assemble full report MD.
  * If **Save .ipynb**: assemble notebook.
  * Clipboard/download actions and toasts.
* **Events:** Uses `locationchange` patch to refresh capture badge.

---

### Userscript

#### `userscripts/lc-md-notebook-bootstrap.user.js`

* **Only** responsibility is to:

  * Guard single install.
  * `@require` all modules from GitHub (`__GH_USER__/__REPO__/__BRANCH__` placeholders).
  * Wait for DOM ready, then call `LCMD.pipeline.bootstrap()` (or nearest equivalent); retry until available.

---

## 5) Data & storage

* **Per-session store key:** `lc_capture_store_v2` in `sessionStorage`:

  ```jsonc
  {
    "<slug>": {
      "custom": { "value": "<blob>", "when": 1700000000000 },
      "typed":  { "value": "<code>", "lang": "python3", "when": 1700000000000 }
    }
  }
  ```
* **Slug detection:** `/problems/:slug` or `/contest/*/problems/:slug`.

---

## 6) Events & messages

* `window` event: **`lc-input-v2`** `{ customInput, typedCode, lang }` (from network tap)
* `document`:

  * **`lc-monaco-request-top`** (request)
  * **`lc-monaco-dump-top`** `{ code, langId, __info }` (response)
* `postMessage` frame bridge:

  * send `{ type:'lc-monaco-request', id }`
  * receive `{ type:'lc-monaco-dump', id, data:{ code, langId, __info } }`

---

## 7) Error handling & performance

* **Never** throw to top-level UI for noncritical failures; log and continue with partial results.
* Use timeouts on all async waits:

  * Monaco wait: `WAIT_MONACO_MS`
  * Popup open: `GLOSSARY.OPEN_TIMEOUT_MS`
  * Content stabilization: `CONTENT_READY.TIMEOUT_MS`
  * Image fetch: `IMAGE_TIMEOUT_MS`
* Submissions details throttled by `BETWEEN_DETAIL_MS` per item.

---

## 8) Coding conventions

* Use the established IIFE + `NS.defineNS()` pattern and attach exports to `LCMD.something`.
* Avoid hard dependencies across layers; depend on namespaced APIs (e.g., `LCMD.util.*`, `LCMD.net.*`).
* For new modules:

  * Document **Responsibilities**, **Exports**, **Inputs**, **Outputs**, **Side-effects**.
  * Include **timeouts** and **fallbacks**.
* Do not block UI: any long loop should be chunked or throttled.

---

## 9) Extensibility notes

* To add a new feature, prefer a new module file; expose a small, tested API; wire into `pipeline` or `toolbar` as needed.
* To change problem parsing, add new GraphQL query **variant** rather than modifying existing in place.
* To support non-Python notebooks, add language-specific adapters in `nb/cells.js` (execute only Python; others print code with rationale).

---

## 10) Quick API index

* **Pipeline:** `LCMD.pipeline.bootstrap()`
* **GraphQL:** `LCMD.lc.gql.queryQuestion(slug)`, `queryHints(slug)`, `querySubmissionList(slug, {offset,limit})`, `querySubmissionDetails(id)`
* **REST fallback:** `LCMD.lc.rest.checkSubmission(id)`
* **HTML→MD:** `LCMD.md.htmlToMarkdownAdvanced(html, { inlineImages, pairs? })`
* **Glossary:** `LCMD.md.captureGlossaryFromLiveDescription()`
* **Images:** `LCMD.net.images.embedInHtml(html)`
* **Notebook:** `LCMD.nb.buildNotebook(...)`
* **Monaco:** `LCMD.monaco.requestTopDump()`, `LCMD.monaco.requestFromFrames()`
* **Storage scan:** `LCMD.heur.scanLocalStorageHeuristic(slug, q)`
* **Utils:** see Util section above.

---

## 11) Util (detailed)

### util/string.js

* **Exports:** `nonEmpty`, `clip`, `sanitizeCodeForMarkdown`, `commentOutsideFences`, `escapeRegExp`, `normalizeWhitespace`, `lines`, `indent`, `stripMarkdown`, `slugify`
* **Note:** legacy `j` → use `util/json.tryStringify` or `stableStringify`.

### util/parse.js

* **Exports:** `parseRuntimeMs`, `parseMemoryMB`, `coerceNum`, `fmtPct`
* **Alias:** `LCMD.util.parse === LCMD.util.num`

### util/time.js

* **Exports:** `toLocalStringFromEpochSec`, `sleep`, `nowMs`, `formatDurationMs`, `debounce`, `throttle`

### util/url.js

* **Exports:** `absolute`, `getCookie`, `join`, `isHttpUrl`
* **Compat:** `makeAbsoluteUrl` → `absolute`.

### util/guards.js

* **Exports:** `ensureSingleInit(key: string): boolean`, `isSameOriginFrame(iframeEl)`, `listSameOriginFrames(root?): Array<{ el, win, doc }>`
* **Compat:** `singleInstall` → `ensureSingleInit`.

### util/langmap.js

* **Exports:** `labelFromMonacoId`, `fenceFromLabelOrId`, `normalizeFence`, `normalizeFenceFromLabel`, `KNOWN`

### util/json.js

* **Exports:** `safeParse`, `tryStringify`, `stableStringify`, `deepClone`

### util/array.js

* **Exports:** `uniqueBy`, `flatten`, `chunk`, `zip`

### util/object.js

* **Exports:** `pick`, `omit`, `merge`, `get`, `set`

### util/promise.js

* **Exports:** `deferred`, `withTimeout`, `retry`

---

## 12) Testing checklist

* Problem pages on both `leetcode.com` and `leetcode.cn`.
* Submissions list with mixed statuses and languages.
* Monaco present vs. in iframe vs. absent.
* Glossary popovers that are slow to load or have minimal content.
* Images that are cross-origin vs. same-origin; large images.
* Custom input captured after clicking **Run**; badge updates across navigation (SPA).
* Notebook executes harness on Python code (both reference and current editor code).

---

This document is the **single source of truth** for module responsibilities, public APIs, and integration points. Keep it synchronized with code changes.
