/* src/core/log.js
 * Lightweight logging utility for LCMD.
 * - Levels: debug(4), info(3), warn(2), error(1), off(0)
 * - Ring buffer with max lines; tee to console; optional console capture.
 * - Clipboard export (navigator.clipboard or GM_setClipboard).
 * - Emits CustomEvent('lcmd:log', {level, text}) per entry.
 * - Idempotent: safe to load multiple times.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var core = NS.defineNS('core');
  if (core.log && core.log.__ready__) return; // already initialized

  /* ---------- state ---------- */
  var originalConsole = null;
  var state = {
    level: 3,            // info
    buffer: [],
    max: 2000,           // max buffered lines
    tee: true,           // also print to console
    captureConsole: false,
    timestamps: true
  };

  /* ---------- helpers ---------- */
  function levelNum(l) {
    var s = String(l).toLowerCase();
    if (s === 'off') return 0;
    if (s === 'error') return 1;
    if (s === 'warn') return 2;
    if (s === 'info') return 3;
    if (s === 'debug') return 4;
    var n = +l; return isFinite(n) ? n : state.level;
  }

  function toPieces(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) {
      var v = args[i];
      if (typeof v === 'string') { out.push(v); continue; }
      try {
        if (v && (v.stack || v.message)) out.push(String(v.stack || v.message));
        else out.push(JSON.stringify(v));
      } catch (_){ out.push(String(v)); }
    }
    return out;
  }

  function record(levelName, args) {
    var ts = state.timestamps ? new Date().toISOString() + ' ' : '';
    var txt = ts + '[' + levelName + '] ' + toPieces(args).join(' ');
    state.buffer.push(txt);
    if (state.buffer.length > state.max) {
      state.buffer.splice(0, state.buffer.length - state.max);
    }
    try { document.dispatchEvent(new CustomEvent('lcmd:log', { detail: { level: levelName, text: txt } })); } catch (_) {}
  }

  function logAt(levelName, minLevel, consoleMethod) {
    return function () {
      if (state.level >= minLevel) {
        record(levelName, arguments);
        if (state.tee && root.console && root.console[consoleMethod]) {
          try {
            var prefix = ['[LCMD]', levelName + ':'];
            root.console[consoleMethod].apply(root.console, prefix.concat([].slice.call(arguments)));
          } catch (_) {}
        }
      }
    };
  }

  /* ---------- API ---------- */
  var api = {
    __ready__: true,

    setLevel: function (l) { state.level = levelNum(l); return state.level; },
    level: function () { return state.level; },

    teeToConsole: function (on) { state.tee = !!on; return state.tee; },
    setMaxLines: function (n) { if (n > 0) state.max = n | 0; return state.max; },

    enableConsoleCapture: function () {
      if (state.captureConsole || !root.console) return;
      originalConsole = originalConsole || {
        log: root.console.log,
        info: root.console.info,
        warn: root.console.warn,
        error: root.console.error,
        debug: root.console.debug
      };
      root.console.log   = logAt('console', 3, 'log');
      root.console.info  = logAt('console', 3, 'info');
      root.console.warn  = logAt('console', 2, 'warn');
      root.console.error = logAt('console', 1, 'error');
      root.console.debug = logAt('console', 4, ('debug' in root.console ? 'debug' : 'log'));
      state.captureConsole = true;
    },

    disableConsoleCapture: function () {
      if (!state.captureConsole || !originalConsole) return;
      root.console.log   = originalConsole.log;
      root.console.info  = originalConsole.info;
      root.console.warn  = originalConsole.warn;
      root.console.error = originalConsole.error;
      if (originalConsole.debug) root.console.debug = originalConsole.debug;
      state.captureConsole = false;
    },

    attachGlobalErrors: function () {
      if (api.__errorsAttached) return;
      api.__errorsAttached = true;
      root.addEventListener('error', function (ev) {
        api.error('window.onerror', ev && (ev.error || ev.message) || ev);
      });
      root.addEventListener('unhandledrejection', function (ev) {
        var r = ev && ev.reason;
        api.error('unhandledrejection', r && (r.stack || r.message) || r);
      });
    },

    clear: function () { state.buffer = []; },
    getLines: function () { return state.buffer.slice(); },
    dumpText: function () { return state.buffer.join('\n'); },

    copyToClipboard: function () {
      var text = api.dumpText();
      try {
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
          return root.navigator.clipboard.writeText(text);
        }
      } catch (_) {}
      try {
        if (typeof root.GM_setClipboard === 'function') {
          root.GM_setClipboard(text, { type: 'text', mimetype: 'text/plain' });
          return Promise.resolve();
        }
      } catch (_) {}
      try {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        return Promise.resolve();
      } catch (e) { return Promise.reject(e); }
    },

    debug: logAt('debug', 4, ('debug' in (root.console || {}) ? 'debug' : 'log')),
    info:  logAt('info',  3, 'info'),
    warn:  logAt('warn',  2, 'warn'),
    error: logAt('error', 1, 'error'),

    mark: function (tag) { api.info('---', tag || 'MARK', '---'); }
  };

  core.log = api;

})(window.LCMD);
