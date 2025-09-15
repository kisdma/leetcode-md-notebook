// ==UserScript==
// @name         LeetCode → Full Markdown & Jupyter (Bootstrap, modular)
// @namespace    https://tampermonkey.net/
// @version      5.0.0
// @description  Bootstrap that loads modular LCMD from GitHub (@require) and starts the pipeline.
// @author       You
//
// @match        https://leetcode.com/problems/*
// @match        https://leetcode.com/contest/*/problems/*
// @match        https://leetcode.cn/problems/*
// @match        https://leetcode.cn/contest/*/problems/*
//
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
//
// @updateURL    https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/userscripts/lc-md-notebook-bootstrap.user.js
// @downloadURL  https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/userscripts/lc-md-notebook-bootstrap.user.js
//
// --- Core namespace & config ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/namespace.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/config.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/log.js
//
// --- Utils (planned + new) ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/string.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/time.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/parse.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/url.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/guards.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/langmap.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/json.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/array.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/object.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/util/promise.js
//
// --- DOM helpers ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/dom/ready.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/dom/selectors.js
//
// --- Network & images ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/net/gm_xhr.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/net/images.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/net/network_tap.js
//
// --- Monaco capture ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/monaco_top.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/monaco_frames.js
//
// --- Heuristics ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/storage_scan.js
//
// --- LeetCode API clients ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/lc_api/graphql.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/lc_api/rest_check.js
//
// --- Markdown & report ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/md/html_to_md.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/md/glossary_markdown.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/md/report_build.js
//
// --- Notebook ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/nb/cells.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/nb/notebook_build.js
//
// --- UI & Orchestration ---
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/ui/toolbar.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/ui/popup_glossary.js
// @require      https://raw.githubusercontent.com/__GH_USER__/__REPO__/__BRANCH__/src/pipeline.js
// ==/UserScript==

/* The placeholders __GH_USER__/__REPO__/__BRANCH__ are replaced by your setup script.
 * Example:
 *   __GH_USER__ = your GitHub username
 *   __REPO__    = leetcode-md-notebook
 *   __BRANCH__  = main
 * This file is intentionally minimal: it guards against multi-install in SPAs and boots LCMD.pipeline.
 */

(function () {
  'use strict';

  // -------- Global Guard (SPA-safe) --------
  try {
    if (unsafeWindow && unsafeWindow.__LC_MD_INSTALLED__) return;
    if (unsafeWindow) unsafeWindow.__LC_MD_INSTALLED__ = true;
  } catch (_) {
    if (window.__LC_MD_INSTALLED__) return;
    window.__LC_MD_INSTALLED__ = true;
  }

  // -------- Lightweight locationchange for SPAs --------
  (function patchHistory(){
    try{
      var push = history.pushState, repl = history.replaceState;
      function fire(){ try { window.dispatchEvent(new Event('locationchange')); } catch(_){ } }
      history.pushState = function(){ var r = push.apply(this, arguments); fire(); return r; };
      history.replaceState = function(){ var r = repl.apply(this, arguments); fire(); return r; };
      window.addEventListener('popstate', fire);
    }catch(_){}
  })();

  // -------- Bootstrap pipeline when ready --------
  function start(){
    var NS   = window.LCMD || {};
    var log  = (NS.core && NS.core.log) || console;
    var pipe = NS.pipeline || {};
    var boot = pipe.bootstrap || pipe.init || pipe.start || pipe.run;

    if (typeof boot === 'function') {
      try { boot(); }
      catch (e) {
        try { (log.error || log.warn || console.error).call(log, '[LCMD] pipeline boot error:', e); } catch(_) {}
      }
    } else {
      try { (log.info || console.log).call(log, '[LCMD] pipeline not found yet; will retry shortly…'); } catch(_) {}
      setTimeout(start, 150);
    }
  }

  // Prefer DOM-ready helper if present
  if (window.LCMD && window.LCMD.dom && window.LCMD.dom.ready && typeof window.LCMD.dom.ready.onReady === 'function') {
    window.LCMD.dom.ready.onReady(start);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
