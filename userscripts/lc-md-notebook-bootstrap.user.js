// ==UserScript==
// @name         LeetCode → Full Markdown & Jupyter (Bootstrap, modular, verbose)
// @namespace    https://tampermonkey.net/
// @version      5.0.5
// @description  Bootstrap loader that pulls modular LCMD from GitHub via @require, starts the pipeline, and logs rich diagnostics.
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
// NOTE: Replace __GH_USER__ and __REF__ (branch like `main` or a pinned commit SHA).
//       Or run your pinning tool to substitute both @require lines and @updateURL/@downloadURL automatically.
// @updateURL    https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/userscripts/lc-md-notebook-bootstrap.user.js
// @downloadURL  https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/userscripts/lc-md-notebook-bootstrap.user.js
//
// ---- PRELUDE (must be first!) ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/core/prelude.js
//
// ---- Core namespace & config ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/core/namespace.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/core/config.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/core/log.js
//
// ---- Utilities ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/string.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/time.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/parse.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/url.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/guards.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/langmap.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/json.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/array.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/object.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/promise.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/util/index.js
//
// ---- DOM helpers ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/dom/ready.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/dom/selectors.js
//
// ---- Network & images ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/net/gm_xhr.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/net/images.js
//
// ---- Capture (page/Monaco/storage/network) ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/capture/network_tap.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/capture/monaco_top.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/capture/monaco_frames.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/capture/storage_scan.js
//
// ---- LeetCode API clients ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/lc_api/graphql.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/lc_api/rest_check.js
//
// ---- Markdown & report ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/md/html_to_md.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/md/glossary_markdown.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/md/report_build.js
//
// ---- Notebook ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/nb/cells.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/nb/notebook_build.js
//
// ---- UI ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/ui/toolbar.js
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/ui/popup_glossary.js
//
// ---- Orchestration (final) ----
// @require      https://raw.githubusercontent.com/__GH_USER__/leetcode-md-notebook/__REF__/src/core/pipeline.js
// ==/UserScript==

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

  // -------- Logger (bootstrap-scoped) --------
  var BOOT = { prefix: '[LCMD/BOOT]' };
  function log(){ try{ console.log.apply(console, [BOOT.prefix].concat([].slice.call(arguments))); }catch(_){} }
  function info(){ try{ console.info.apply(console, [BOOT.prefix].concat([].slice.call(arguments))); }catch(_){} }
  function warn(){ try{ console.warn.apply(console, [BOOT.prefix].concat([].slice.call(arguments))); }catch(_){} }
  function error(){ try{ console.error.apply(console, [BOOT.prefix].concat([].slice.call(arguments))); }catch(_){} }

  // Surface hidden exceptions early
  window.addEventListener('error', function(e){ error('window.error:', e && (e.message || e)); });
  window.addEventListener('unhandledrejection', function(e){ error('unhandledrejection:', e && (e.reason && (e.reason.stack || e.reason.message) || e.reason)); });

  // -------- Show @require list once --------
  try {
    if (typeof GM_info !== 'undefined' && GM_info.scriptMetaStr) {
      var requires = (GM_info.scriptMetaStr.match(/^\s*\/\/\s*@require\s+(\S+)/gm) || [])
        .map(function (l) { return l.replace(/^\s*\/\/\s*@require\s+/, ''); });
      console.groupCollapsed('[LCMD/BOOT] @require list (' + requires.length + ')');
      requires.forEach(function(u, i){ console.log((i+1)+'.', u); });
      console.groupEnd();
    }
  } catch (_) {}

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

  // -------- Diagnostics helpers --------
  var EXPECT_NS = ['core','util','dom','net','capture','lc','md','nb','ui'];
  function nsKeys(obj){ try { return Object.keys(obj||{}); } catch(_){ return []; } }
  function snapshot(depth){
    var root = window.LCMD || {};
    var out = {};
    nsKeys(root).forEach(function(k){
      if (depth <= 0) { out[k] = '(…)'; return; }
      var lvl = {};
      nsKeys(root[k]).forEach(function(k2){
        if (depth <= 1) { lvl[k2] = '(…)'; return; }
        try { lvl[k2] = Object.keys(root[k][k2] || {}); } catch(_) { lvl[k2] = '(uninspectable)'; }
      });
      out[k] = lvl;
    });
    return out;
  }
  function missingTopNamespaces(){
    var root = window.LCMD || {};
    return EXPECT_NS.filter(function(k){ return !(k in root); });
  }
  function bool(x){ return !!x; }
  function presenceMatrix(){
    var R = window.LCMD || {};
    var C = (R.core||{}), U = (R.util||{}), D = (R.dom||{}), N = (R.net||{}), CP = (R.capture||{}),
        L = (R.lc||{}), M = (R.md||{}), NB = (R.nb||{}), UI = (R.ui||{});
    return {
      'core.namespace':        bool(C.namespace),
      'core.config':           bool(C.config),
      'core.log':              bool(C.log),
      'core.pipeline':         bool(C.pipeline),
      'util.string':           bool(U.string),
      'util.time':             bool(U.time),
      'util.parse':            bool(U.parse),
      'util.url':              bool(U.url),
      'util.guards':           bool(U.guards),
      'util.langmap':          bool(U.langmap),
      'util.json':             bool(U.json),
      'util.array':            bool(U.array),
      'util.object':           bool(U.object),
      'util.promise':          bool(U.promise),
      'util.index':            bool(U.index),
      'dom.ready':             bool(D.ready),
      'dom.selectors':         bool(D.selectors),
      'net.gm_xhr':            bool(N.gm_xhr),
      'net.images':            bool(N.images),
      'capture.network_tap':   bool(CP.network_tap),
      'capture.monaco_top':    bool(CP.monaco_top),
      'capture.monaco_frames': bool(CP.monaco_frames),
      'capture.storage_scan':  bool(CP.storage_scan),
      'lc.graphql':            bool(L.graphql),
      'lc.rest_check':         bool(L.rest_check),
      'md.html_to_md':         bool(M.html_to_md),
      'md.glossary_markdown':  bool(M.glossary_markdown),
      'md.report_build':       bool(M.report_build),
      'nb.cells':              bool(NB.cells),
      'nb.notebook_build':     bool(NB.notebook_build),
      'ui.toolbar':            bool(UI.toolbar),
      'ui.popup_glossary':     bool(UI.popup_glossary)
    };
  }

  // -------- Robust pipeline resolver --------
  function resolvePipeline() {
    var NS = (window.LCMD || {});
    var candidates = [
      function(){ return NS.core && NS.core.pipeline; },
      function(){ return NS.pipeline; },
      function(){ return NS.core && NS.core.pipeline && NS.core.pipeline.default; },
      function(){ return NS.pipeline && NS.pipeline.default; }
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var p = candidates[i]();
        if (!p) continue;
        if (typeof p.bootstrap === 'function' || typeof p.init === 'function' || typeof p.start === 'function' || typeof p.run === 'function') {
          return p;
        }
      } catch (_) { /* noop */ }
    }
    return null;
  }
  function callBoot(p) {
    var fn = p.bootstrap || p.init || p.start || p.run;
    return fn && fn();
  }

  // -------- Bootstrap attempts (max 20) --------
  var TRIES = 0;
  var MAX_TRIES = 20;
  var INTERVAL_MS = 200;
  var printedIntro = false;
  var _loggedPresenceOnce = false;

  function introOnce(){
    if (printedIntro) return;
    printedIntro = true;
    var gmAvail = typeof GM_xmlhttpRequest === 'function';
    var gmDl    = typeof GM_download === 'function';
    var gmClip  = typeof GM_setClipboard === 'function';
    info('init', { url: location.href, docReady: document.readyState, gm_xhr: gmAvail, gm_dl: gmDl, gm_clip: gmClip });
  }

  function start(){
    introOnce();

    var NS = window.LCMD || {};
    var p = resolvePipeline();
    if (p) {
      info('pipeline found; booting…', {
        hasCore: !!NS.core,
        pipePath: (NS.core && NS.core.pipeline) ? 'LCMD.core.pipeline' : (NS.pipeline ? 'LCMD.pipeline' : '(unknown)')
      });
      try { callBoot(p); }
      catch (e) { error('pipeline boot error:', e && (e.stack || e.message || e)); }
      return;
    }

    TRIES++;

    // one-time presence matrix on first attempt
    if (!_loggedPresenceOnce) {
      _loggedPresenceOnce = true;
      try {
        console.groupCollapsed('[LCMD/BOOT] presence matrix @ attempt 1');
        console.table(presenceMatrix());
        console.groupEnd();
      } catch(_) { info('presence', presenceMatrix()); }
    }

    var missing = missingTopNamespaces();
    warn('pipeline not ready; retrying', { attempt: (TRIES + '/' + MAX_TRIES), docReady: document.readyState, LCMD_present: !!window.LCMD, missing_ns: missing });

    // Deeper snapshot at attempts 5, 10, 15
    if (TRIES === 5 || TRIES === 10 || TRIES === 15) {
      try { console.groupCollapsed('[LCMD/BOOT] snapshot @ attempt ' + TRIES); console.dir(snapshot(2)); console.groupEnd(); } catch(_) {}
    }

    if (TRIES >= MAX_TRIES) {
      error('giving up after max attempts', {
        attempts: TRIES,
        hint: 'Check Tampermonkey Logs for syntax errors in @require files (e.g., ESM export/import) and ensure modules extend LCMD.* without reassigning it.'
      });
      try {
        console.groupCollapsed('[LCMD/BOOT] final presence matrix');
        console.table(presenceMatrix());
        console.groupEnd();
        console.groupCollapsed('[LCMD/BOOT] final LCMD tree');
        console.dir(snapshot(2));
        console.groupEnd();
      } catch(_) {}
      return;
    }

    setTimeout(start, INTERVAL_MS);
  }

  // Prefer DOM-ready helper if present; otherwise standard DOMContentLoaded.
  function onReady(fn){
    if (window.LCMD && window.LCMD.dom && window.LCMD.dom.ready && typeof window.LCMD.dom.ready.onReady === 'function') {
      try { return window.LCMD.dom.ready.onReady(fn); } catch(_) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(start);
})();
