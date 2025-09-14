// ==UserScript==
// @name         LeetCode → Full Markdown & Jupyter Notebook (bootstrap)
// @namespace    https://tampermonkey.net/
// @version      4.0.0-modular
// @description  Bootstrap that loads modular LCMD from GitHub via @require
// @match        https://leetcode.com/problems/*
// @match        https://leetcode.com/contest/*/problems/*
// @match        https://leetcode.cn/problems/*
// @match        https://leetcode.cn/contest/*/problems/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/core/namespace.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/core/config.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/util/string.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/util/parse.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/util/time.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/util/url.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/util/guards.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/core/log.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/dom/ready.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/dom/selectors.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/capture/network_tap.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/capture/monaco_top.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/capture/monaco_frames.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/capture/storage_scan.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/net/gm_xhr.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/net/images.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/lc_api/graphql.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/lc_api/rest_check.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/ui/popup_glossary.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/md/glossary_markdown.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/md/html_to_md.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/md/report_build.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/nb/cells.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/nb/notebook_build.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/ui/toolbar.js\n// @require      https://raw.githubusercontent.com/kisdma/leetcode-md-notebook/main/src/core/pipeline.js
// ==/UserScript==

(function () {
  'use strict';
  if ((unsafeWindow && unsafeWindow.__LC_MD_INSTALLED__) || window.__LC_MD_INSTALLED__) return;
  try { (unsafeWindow || window).__LC_MD_INSTALLED__ = true; } catch(_) { window.__LC_MD_INSTALLED__ = true; }

  try { window.LCMD.core.pipeline.bootstrap(); } catch (e) {
    console.error('[LCMD] bootstrap error:', e);
  }
})();
