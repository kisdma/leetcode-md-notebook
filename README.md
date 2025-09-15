# LeetCode → Full Markdown & Jupyter Notebook

*fast popup glossary • submissions mining • inline images • shared test harness*

This project is the modular rewrite of a single (very large) Tampermonkey/Greasemonkey userscript that turns any LeetCode problem page into a polished Markdown report and an executable Jupyter notebook—while also popping open glossary tooltips to capture their content immediately.

It works on both `leetcode.com` and `leetcode.cn`, including contest problem pages.

---

## What it does

* **Copy a rich Markdown report** to clipboard:

  * Problem header (ID, title, difficulty, topics, similar problems)
  * Fully converted **Description** with **inline images embedded as data URLs**
  * **Glossary** captured from the live UI (opens tooltips, waits for stable content, converts to MD and anchors terms inline)
  * **Default & Custom testcases** (custom captured from your “Run” requests)
  * **Submissions table** (runtime/memory & “beats %” when available)
  * **Per-submission code blocks** (for recent history)

* **Export a Jupyter Notebook (.ipynb)**:

  * A shared **Python test harness** that runs all unique testcases
  * Optional **ReferenceSolution** (latest Accepted Python submission), used to validate your current code
  * Cells for the **current Monaco editor code** and best-effort **localStorage code**
  * One cell per recent submission (Python executes; other langs display source)

* **Copy a diagnostic log** for debugging.

* **Live UI**: a floating toolbar (Copy Report / Save .ipynb / Copy Log) with a “Custom run captured” badge.

---

## Why the “fast popup glossary”?

LeetCode’s description often hides definitions behind interactive popovers (Radix/HeadlessUI/Ant tooltips). This userscript programmatically **clicks the glossary terms**, waits for **meaningful, stable content**, then converts it to Markdown and anchors the first mention in the description. You get a **clean “Glossary” section** without manually opening each tooltip.

---

## How it works (high level)

1. **Global SPA guard**
   Sets a flag in page context to ensure the script runs once per page lifecycle, even with client-side navigation.

2. **Network tap (page context)**
   A guarded `fetch` wrapper extracts fields from LeetCode POSTs (GraphQL and run/submit endpoints):

   * `customInput` – the custom test blob you run
   * `typedCode` – editor contents LeetCode sends
   * `lang` – language slug
     These are dispatched as `lc-input-v2` events and cached per `titleSlug` in `sessionStorage`.

3. **Monaco dumps**

   * **Top document**: ask Monaco for the focused → visible → first editor’s model; if none, take the largest model.
   * **Frames**: do the same inside same-origin iframes via `postMessage`; return the first non-empty dump.

4. **LocalStorage heuristic**
   Walks `localStorage` entries (including JSON blobs), collects string leaves that look like code, and picks the best candidate—prefer keys that include the slug and code that matches LeetCode patterns (e.g., `class Solution`, function name from snippets).

5. **Question, hints, submissions**

   * GraphQL queries fetch question metadata, hints (several schema variants), and recent submissions (pagination with hard cap).
   * For each submission, a **details** call tries to get code/runtime/memory/percentiles.
     If beats/runtime/memory are missing, it falls back to `.../submissions/detail/{id}/check/`.

6. **HTML → Markdown**

   * Converts the problem description to MD (headings, lists, tables, code, inline `sup/sub`, anchors).
   * **Images** are inlined via `GM_xmlhttpRequest` (if allowed) or `fetch` fallback; a summary footer indicates embed successes/failures.
   * **Glossary** capture occurs **first**, so popups open immediately; their content is cleaned and appended as a “Glossary” section.

7. **Testcases**
   Guesses variable names (from GraphQL meta, from description “Input: …”, or heuristics).
   Splits blobs into cases, supporting the common “first line is test count” shape.
   **Unique testcases** are the union of defaults + captured custom runs.

8. **Notebook builder**

   * First cell: Markdown report (header/description/hints/testcases/submissions).
   * Harness cell: robust argument parsing (JSON, `ast.literal_eval`, CSV-ish, whitespace), normalization, and a loop that can cross-check against `ReferenceSolution` if present.
   * Reference cell: latest Accepted Python submission (exec’d as literal string).
   * Cells for current Monaco code and localStorage code (exec if Python; else print).
   * One cell per submission (exec if Python).

9. **UI & UX**
   Injects a fixed toolbar and toast. Observes DOM mutations to **auto-heal** if the site re-renders.

---

## Permissions & scope

Grease/Tampermonkey metadata (original monolith):

* `@match`
  `https://leetcode.com/problems/*`
  `https://leetcode.com/contest/*/problems/*`
  `https://leetcode.cn/problems/*`
  `https://leetcode.cn/contest/*/problems/*`
* `@grant`
  `GM_setClipboard` – copy report/log text
  `GM_xmlhttpRequest` – cross-origin image fetch for inlining
  `GM_download` – save `.ipynb` reliably
  `unsafeWindow` – guarded access for SPA/Monaco/flags
* `@connect *` – needed to fetch remote images referenced by the description
* `@run-at document-start` – to install the network tap as early as possible

The script **does not send data to any third-party servers**. It only talks to LeetCode endpoints already used by the site, and fetches image URLs present in the page to inline them.

---

## Repository layout (modular rewrite)

```
src/
  core/
    namespace.js       # global namespace helper (LCMD.defineNS) + SPA guard helpers
    config.js          # central config (timeouts, UI placement, limits)
    log.js             # lightweight logger (info/debug/warn/error)
  capture/
    network_tap.js     # page-context fetch wrapper → lc-input-v2 events
    monaco_top.js      # top-document Monaco dumper
    monaco_frames.js   # same-origin iframe Monaco dumper
    storage_scan.js    # localStorage heuristic code finder
  ui/
    toolbar.js         # floating bar + toast + “custom run captured” badge
    popup_glossary.js  # open/await/sanitize glossary popovers and return HTML
  pipeline/
    pipeline.js        # orchestrates fetches, conversion, and notebook assembly
README.md
```

> In userscript mode, the **bootstrap** uses `@require` to pull these modules from raw GitHub URLs and wires them in roughly the same order as the monolith.

---

## Buttons & behaviors

* **Copy Report**: runs the full pipeline and copies Markdown to clipboard.
* **Save .ipynb**: builds the notebook and downloads it via `GM_download` (or data URL fallback).
* **Copy Log**: runs the pipeline with verbose tracing and copies the log.
* **Badge** “Custom run: …”: reads the session store for the current slug; updates on SPA navigation.

---

## Configuration knobs

Edit `src/core/config.js` (or override in your bootstrap):

* **CONTENT\_READY**: thresholds for glossary popup stabilization (min chars, stable samples, gaps, timeout).
* **GLOSSARY\_CFG**: hover/click waits, proximity radius, and open/close time budgets.
* **UI positions**: toolbar offsets/z-index; toast duration.
* **Fetch limits**: max submissions, page size, pacing between detail requests.
* **Image fetch**: timeouts; whether to inline images by default.
* **Notebook/MD switches**: include language labels, code-block collapsing, etc.

---

## Troubleshooting

* **“Custom run: not captured yet”**
  Click **Run** once, then press **Copy Report** / **Save .ipynb** again. The network tap listens to LeetCode’s POST bodies.
* **No editor code found**
  Focus the editor tab once; Monaco may be lazily hydrated. If still empty, check if the editor is inside a cross-origin iframe (rare).
* **Images not embedded**
  Some hosts disallow CORS or are blocked by the userscript manager. The report notes how many were embedded vs left as remote.
* **Percentiles missing**
  The script falls back to `/submissions/detail/{id}/check/`, but historical runs may not expose beats % for all submissions.
* **Notebook doesn’t execute my code**
  Only **Python** cells auto-execute with the harness. Other languages are printed for reference.

---

## Known limitations

* If LeetCode significantly changes GraphQL fields or the UI tooltip framework, glossary capture or some fields may need minor updates.
* Cross-origin iframes can’t be inspected; the frames dumper only reads **same-origin** editors.
* Very heavy descriptions with many large images inline can make the Markdown large; adjust image inlining in config if needed.

---

## Security & privacy

* No data is exfiltrated. Everything stays in your browser and on LeetCode.
* The script reads/writes:

  * `sessionStorage` (per-tab) for captured custom input & editor snapshots
  * `localStorage` (read-only) to heuristically find past code
* Network requests:

  * LeetCode `graphql` and submissions APIs you already use
  * `GM_xmlhttpRequest` to fetch images referenced by the problem description (to inline them)

---

## Credits

* The original single-file userscript, reorganized into modules for maintainability and LLM-assisted evolution.
* Monaco Editor, LeetCode GraphQL APIs, and UI frameworks (Radix/HeadlessUI/Ant) that power the site’s experience.

---

## License

MIT (unless you prefer to attach a different license in this repo).
