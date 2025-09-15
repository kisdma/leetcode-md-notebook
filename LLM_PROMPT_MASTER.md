# LCMD Modular System — Contracts for LLM

This master file describes each module's purpose and boundaries so individual files can be evolved safely.
(You can replace this with your full prompt spec later.)

Global namespace: `window.LCMD` (also available via `unsafeWindow.LCMD` in TM pages).
Version: 4.0.0-modular. All modules MUST be side-effect free on load, exporting functions only. The orchestrator calls them.

## Core

### core/namespace.js
- Purpose: Define `window.LCMD` with sub-namespaces: {core, ui, capture, lc_api, md, nb, dom, net, util}.
- Exports: none (creates namespace). MUST BE FIRST in @require.
- Invariants: Idempotent; never overwrite existing LCMD keys.

### core/config.js
- Purpose: Central tunables/flags used across modules.
- Exports: `LCMD.core.config` with:
  - limits (MAX_SUBMISSIONS, PAGE_SIZE, BETWEEN_DETAIL_MS, …),
  - UI/trace flags,
  - glossary/content readiness settings.
- Invariants: No DOM access; pure data object.

### core/log.js
- Purpose: Logging infra + optional line capture for “Copy Log”.
- Exports: `LCMD.core.log` with `{ log(...), enable(), disable(), get() }`.
- Invariants: No external dependencies except `console`. Do not import DOM.

### core/pipeline.js
- Purpose: High-level orchestration (was `runPipeline`, plus handlers for Copy Report / Copy Log / Save .ipynb).
- Exports:
  - `bootstrap()` → installs UI, SPA guards, network tap, event handlers.
  - `run({ produceReport:boolean, wantNotebook:boolean })` → returns `{ md?, notebook?, filename? }`.
  - `handlers` object with `{ onCopyReport, onCopyLog, onSaveNotebook }` used by `ui/toolbar`.
- Dependencies:
  - util/*, dom/*, capture/*, lc_api/*, md/*, nb/*, ui/toolbar.
- Invariants:
  - No UI element creation directly (delegate to `ui/toolbar`).
  - All async steps cancellable by user interactions (best-effort).
  - Respect config flags and not mutate config.

## DOM

### dom/ready.js
- Purpose: DOM ready helper and SPA history patch.
- Exports: `LCMD.dom.ready` with `{ onReady(fn), patchHistory() }`.
- Invariants: No coupling to LC-specific logic.

### dom/selectors.js
- Purpose: Central selectors & small finders.
- Exports: `LCMD.dom.selectors` with:
  - `descriptionRoot()`
  - `findGlossaryButtons(root)`
  - `visibleLangLabel()`
- Invariants: No network. May read DOM safely.

## Capture

### capture/network_tap.js
- Purpose: Hook `fetch` to capture `{ customInput, typedCode, lang }` events.
- Exports: `LCMD.capture.networkTap.install(callback)`.
- Invariants: Injects into page context via <script> tag. Emits `lc-input-v2`.

### capture/monaco_top.js
- Purpose: Top window monaco dump: request/response via custom events.
- Exports: `LCMD.capture.monacoTop.install()` and `LCMD.capture.monacoTop.request(timeoutMs): Promise<{code, langId, __info}>`.
- Invariants: No cross-frame access.

### capture/monaco_frames.js
- Purpose: Inject monaco dump helper into same-origin iframes; collect first non-empty code.
- Exports: `LCMD.capture.monacoFrames.request(timeoutPerMs): Promise<{code, langId, __info}>`.
- Invariants: Same-origin check. Safe failure on exceptions.

### capture/storage_scan.js
- Purpose: Heuristic scan of localStorage for plausible code for the current slug.
- Exports: `LCMD.capture.storageScan.scan(slug, questionMeta): { ok, code, meta }`.
- Invariants: No network. Never throws.

## LeetCode API

### lc_api/graphql.js
- Purpose: GraphQL plumbing with retries & variants.
- Exports:
  - `gql.call(query, vars): Promise<any>`
  - `gql.fetchQuestion(slug)`
  - `gql.fetchHints(slug)`
  - `gql.fetchSubmissions(slug, {limit, pageSize})`
  - `gql.fetchSubmissionDetails(id)`
- Invariants: Always resolves/rejects with useful Error messages. Never returns partial invalid structures.

### lc_api/rest_check.js
- Purpose: REST fallback `/submissions/detail/{id}/check/`.
- Exports: `restCheck.fetch(id, {tries}): Promise<{ runtimeBeats?, memoryBeats?, runtimeStr?, memoryStr?, runtimeMs?, memoryMB? }>`
- Invariants: Exponential backoff inside `tries`.

## Markdown

### md/html_to_md.js
- Purpose: Robust HTML→Markdown with inline image embedding via `net/images`.
- Exports: `htmlToMd.convert(html, { inlineImages, pairs? }): Promise<{ md, imgStats, footnotes }>`
- Invariants: No UI. Deterministic output for same HTML/config.

### md/glossary_markdown.js
- Purpose: Build glossary anchors/labels and inject refs into description.
- Exports:
  - `glossary.captureFromLive(root, cfg): Promise<Array<{term,label,md,method,mdLen}>>`
  - `glossary.injectAnchors(descMd, pairs): string`
- Invariants: Tolerates no glossary present.

### md/report_build.js
- Purpose: Assemble final Markdown report from pieces.
- Exports: `report.build(params): string`
- Params include: header MD, description MD, hints, testcases, submissions table, code blocks sections.

## Notebook

### nb/cells.js
- Purpose: Cell factories (mdCell, pyCell), harness & reference cell builders.
- Exports: `cells.{ mdCell, pyCell, harness(varNames, uniqCases), reference(subRows, detailsMap), monacoCell(editor), storageCell(scan) }`

### nb/notebook_build.js
- Purpose: Assemble final ipynb object + filename.
- Exports: `nb.build(params): { notebook, filename }`

## UI

### ui/toolbar.js
- Purpose: Render floating buttons, toast, capture badge; wire up to pipeline handlers.
- Exports: `toolbar.ensure({ onCopyReport, onCopyLog, onSaveNotebook })` and `toolbar.updateCaptureBadge(state)`
- Invariants: Self-heal via MutationObserver. No heavy logic; delegates.

### ui/popup_glossary.js
- Purpose: Low-level popup open/close/wait; uses config thresholds.
- Exports: `popup.{ waitContentReady, nearestOpen, clickOpenAndGetHTML }`

## Net

### net/gm_xhr.js
- Purpose: GM_xmlhttpRequest wrappers and arrayBuffer→base64.
- Exports: `gmxhr.{ available(), request(opts), ab2b64(arrayBuffer) }`

### net/images.js
- Purpose: `fetchImageAsDataURL` with GM_xhr or fetch fallback.
- Exports: `images.fetchAsDataURL(url, timeoutMs): Promise<{ok, dataUrl?, mime?, size?, error?}>`

## Util

### util/string.js
- Exports: `nonEmpty, clip, sanitizeCodeForMarkdown, commentOutsideFences, j`
### util/parse.js
- Exports: `parseRuntimeMs, parseMemoryMB, coerceNum`
### util/time.js
- Exports: `toLocalStringFromEpochSec`
### util/url.js
- Exports: `getCookie, makeAbsoluteUrl`
### util/guards.js
- Exports: `singleInstall(key:string): boolean`, `isSameOriginFrame(iframeEl)`, `listSameOriginFrames(): Array<{el,win,doc}>`

## Orchestration Sequence (reference)

1. `dom.ready.patchHistory()`, `dom.ready.onReady(...)`
2. `ui.toolbar.ensure(...)`
3. `capture.networkTap.install(onCapture)`
4. Begin `pipeline.run({ produceReport|wantNotebook })` when buttons pressed:
   - parallel: `lc_api.graphql.fetchQuestion`, `.fetchSubmissions`, `.fetchHints`
   - glossary capture first (`ui.popup_glossary`), reuse in MD
   - monaco dump (`capture.monaco_top` then frames), storage scan heuristics
   - details per submission (GraphQL + REST fallback)
   - assemble MD (md/html_to_md + md/report_build) and/or NB (nb/notebook_build)
5. Clipboard or file save (GM APIs if available; fallback to data: URL → anchor).

### Change Hazards (do NOT break)
- Public function names & return shapes above.
- Namespace path stability (e.g., `LCMD.capture.networkTap.install`).
- Long-running UI actions must remain responsive (no blocking loops).
