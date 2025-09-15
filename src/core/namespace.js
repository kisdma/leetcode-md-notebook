// src/core/namespace.js
// Classic IIFE that *extends* window.LCMD (created by prelude) and never reassigns it.
// Adds helpers to attach modules with safety checks + rich diagnostics.
(function (root) {
  'use strict';

  var g = root || (typeof window !== 'undefined' ? window : this);

  // ---- Guard: base namespace must exist (prelude should have created this) ----
  var LC = g.LCMD || (g.LCMD = {});
  LC.core = LC.core || {};

  // ---- Bootstrap-local logger with levels (can read LOG_LEVEL from config if present) ----
  var LOG_PREFIX = '[LCMD/NS]';
  var LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
  var defaultLevel = 2; // info
  try {
    // If config is already loaded, respect it; else keep default
    var cfgLevel = (LC.core.config && LC.core.config.LOG_LEVEL);
    if (typeof cfgLevel === 'string' && (cfgLevel.toLowerCase() in LEVELS)) {
      defaultLevel = LEVELS[cfgLevel.toLowerCase()];
    } else if (typeof cfgLevel === 'number' && isFinite(cfgLevel)) {
      defaultLevel = Math.max(0, Math.min(4, cfgLevel|0));
    }
  } catch (_) {}

  var CURRENT_LEVEL = defaultLevel;
  function rawLog(method, args) {
    try { (console[method] || console.log).apply(console, [LOG_PREFIX].concat(args)); } catch (_) {}
  }
  function logAt(levelName) {
    var lvl = LEVELS[levelName] ?? 2;
    return function () {
      if (lvl <= CURRENT_LEVEL) rawLog(levelName === 'trace' ? 'debug' : levelName, Array.prototype.slice.call(arguments));
    };
  }
  var log   = logAt('info');
  var info  = logAt('info');
  var warn  = logAt('warn');
  var error = logAt('error');
  var debug = logAt('debug');
  var trace = logAt('trace');

  // ---- Small utils ----
  function isObj(x) { return x && typeof x === 'object'; }
  function asArray(x) { return Array.isArray(x) ? x : [x]; }
  function keys(obj) { try { return Object.keys(obj || {}); } catch (_) { return []; } }

  // ---- Namespace helpers ----
  // Walks LCMD.* path like "util.string" ensuring objects exist; returns the final object
  function ensurePath(path) {
    if (!path || typeof path !== 'string') throw new Error('ensurePath: invalid path');
    var segs = path.split('.').filter(Boolean);
    if (!segs.length) throw new Error('ensurePath: empty path');
    var node = LC;
    var created = [];
    for (var i = 0; i < segs.length; i++) {
      var k = segs[i];
      if (!isObj(node[k])) { node[k] = {}; created.push(segs.slice(0, i + 1).join('.')); }
      node = node[k];
    }
    return { node: node, created: created };
  }

  // Gets the object or value at path, or undefined
  function getPath(path) {
    if (!path || typeof path !== 'string') return undefined;
    var segs = path.split('.').filter(Boolean);
    var node = LC;
    for (var i = 0; i < segs.length; i++) {
      if (!isObj(node) && i < segs.length - 1) return undefined;
      node = node[segs[i]];
      if (node == null) return undefined;
    }
    return node;
  }

  // Sets a value at path; creates parents if needed. Options:
  //  - overwrite (default: false) → whether to overwrite a non-undefined target
  //  - enumerable (default: true)
  //  - configurable (default: true)
  function setPath(path, value, opts) {
    var o = Object.assign({ overwrite: false, enumerable: true, configurable: true }, opts || {});
    if (!path || typeof path !== 'string') throw new Error('setPath: invalid path');
    var segs = path.split('.').filter(Boolean);
    var leafKey = segs.pop();
    var parentInfo = ensurePath(segs.join('.'));
    var parent = parentInfo.node;

    if (Object.prototype.hasOwnProperty.call(parent, leafKey) && parent[leafKey] !== undefined && !o.overwrite) {
      warn('setPath: refused to overwrite existing path:', path);
      return { ok: false, reason: 'exists' };
    }
    try {
      Object.defineProperty(parent, leafKey, {
        value: value,
        enumerable: !!o.enumerable,
        configurable: !!o.configurable,
        writable: true
      });
    } catch (e) {
      // Fallback if defineProperty fails (rare)
      parent[leafKey] = value;
    }
    return { ok: true };
  }

  // Attach a module object under a known bucket (e.g., ('util', 'string', {…}))
  function attach(bucket, key, mod, opts) {
    if (!bucket || !key) throw new Error('attach: need bucket and key');
    var path = bucket + '.' + key;
    var r = setPath(path, mod, opts);
    if (r.ok) {
      info('attach:', path, '→ OK');
    } else {
      warn('attach:', path, '→ SKIPPED (', r.reason, ')');
    }
    return r.ok;
  }

  // Does a value already exist at path?
  function exists(path) { return getPath(path) !== undefined; }

  // List keys inside a bucket/path
  function list(path) {
    var node = getPath(path);
    return keys(node);
  }

  // Snapshot LCMD tree up to a depth (default 2)
  function snapshot(depth) {
    var D = typeof depth === 'number' ? depth : 2;
    function take(node, d) {
      if (!isObj(node) || d <= 0) return '(…)';
      var out = {};
      keys(node).forEach(function (k) {
        out[k] = take(node[k], d - 1);
      });
      return out;
    }
    return take(LC, D);
  }

  // Update log level at runtime (e.g., LCMD.core.namespace.setLogLevel('debug'))
  function setLogLevel(level) {
    var v = level;
    if (typeof level === 'string') v = LEVELS[level.toLowerCase()];
    if (typeof v === 'number' && v >= 0 && v <= 4) {
      CURRENT_LEVEL = v | 0;
      info('log level set to', CURRENT_LEVEL);
    } else {
      warn('setLogLevel: invalid level', level);
    }
  }

  // ---- Expose API on LCMD.core.namespace ----
  var api = {
    version: '1.2.0',
    ensure: ensurePath,        // ({node, created})
    get: getPath,              // (path) -> any
    set: setPath,              // (path, value, opts?) -> {ok}
    attach: attach,            // (bucket, key, mod, opts?) -> bool
    exists: exists,            // (path) -> boolean
    keys: list,                // (path) -> string[]
    snapshot: snapshot,        // (depth=2) -> object
    setLogLevel: setLogLevel,  // ('debug' | 3 | etc.)
    LEVELS: Object.assign({}, LEVELS)
  };

  // Install only if not installed already; allow later modules to reuse it
  if (!LC.core.namespace) {
    LC.core.namespace = api;
  } else {
    // If already present, merge non-destructively
    try {
      var tgt = LC.core.namespace;
      keys(api).forEach(function (k) { if (tgt[k] == null) tgt[k] = api[k]; });
    } catch (_) {}
  }

  // ---- Environment diagnostics (one-time) ----
  (function diag() {
    var inTM  = typeof GM_info !== 'undefined';
    var hasUW = typeof unsafeWindow !== 'undefined';
    var sameRef = hasUW ? (unsafeWindow === g) : null;
    var buckets = ['core','util','dom','net','capture','lc','md','nb','ui'];
    var presence = {};
    buckets.forEach(function (b) { presence[b] = isObj(LC[b]); });

    try {
      console.groupCollapsed(LOG_PREFIX + ' init');
      console.log('url:', g.location && g.location.href);
      console.log('origin:', g.location && g.location.origin);
      console.log('docReady:', (g.document && g.document.readyState));
      console.log('tampermonkey:', !!inTM, inTM ? (GM_info && GM_info.script && GM_info.script.name) : '(n/a)');
      console.log('unsafeWindow:', hasUW, hasUW ? ('sameRef=' + sameRef) : '');
      console.log('buckets:', presence);
      console.log('logLevel:', CURRENT_LEVEL);
      console.groupEnd();
    } catch (_) {}

    // Tiny guard: detect accidental reassignment attempts to LCMD later (logs only)
    try {
      // Only define if not already configurable to avoid throwing
      var desc = Object.getOwnPropertyDescriptor(g, 'LCMD');
      if (!desc || desc.configurable) {
        var _ref = LC;
        Object.defineProperty(g, 'LCMD', {
          configurable: true,
          enumerable: true,
          get: function () { return _ref; },
          set: function (nv) {
            warn('global LCMD reassignment attempt ignored. Use LCMD.core.namespace.attach/set to extend.');
            try { console.debug(LOG_PREFIX, 'newValue snapshot:', nv && Object.keys(nv)); } catch (_) {}
            // Soft-ignore; keep original reference to avoid breaking already-loaded modules
          }
        });
      }
    } catch (_) {
      // Non-fatal if defineProperty is blocked
    }
  })();

})(typeof window !== 'undefined' ? window : this);
