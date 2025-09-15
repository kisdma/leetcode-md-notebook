/* src/core/namespace.js
 * Creates/guards the global LCMD namespace for the modular LeetCode MD/Notebook userscript.
 * - Idempotent: safe to @require multiple times (or across frames).
 * - Pre-creates module buckets: core, ui, capture, lc_api, md, nb, dom, net, util.
 * - Tiny helper API: defineNS(path), getNS(path), noConflict(), lock().
 * - Environment snapshot: GM grants, userAgent, origin, timestamps.
 */
(function () {
  'use strict';

  /** Prefer Tampermonkey's unsafeWindow (top page) when available. */
  var root;
  try {
    /* eslint-disable no-undef */
    root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
    /* eslint-enable no-undef */
  } catch (_) {
    root = window;
  }

  var EXISTING = root.LCMD;

  /** If LCMD already initialized with our major version, exit early (idempotent). */
  if (EXISTING && EXISTING.__ns_ready__ === true) {
    // Stamp the last-touch time for debugging
    try { EXISTING.__last_loaded_at__ = Date.now(); } catch (_) {}
    return;
  }

  /** Safe helpers (no modern syntax to keep broad engine compatibility). */
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(o) { return o && typeof o === 'object'; }

  function shallowFreeze(o) {
    try { Object.freeze(o); } catch (_) {}
    return o;
  }

  /** Minimal, allocation-free path splitter: "a.b.c" -> ["a","b","c"] */
  function splitPath(s) {
    var out = [];
    var cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '.') { if (cur) out.push(cur); cur = ''; }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Environment/probing (avoid throwing if GM_* is missing). */
  function detectEnv() {
    var has = function (name) {
      try { return typeof root[name] === 'function'; } catch (_) { return false; }
    };
    var gmInfo;
    try { gmInfo = (typeof GM_info !== 'undefined') ? GM_info : null; } catch (_) { gmInfo = null; }

    return {
      userAgent: (root.navigator && root.navigator.userAgent) || '',
      origin: (root.location && root.location.origin) || '',
      tampermonkey: !!gmInfo || typeof root.GM === 'object',
      grants: {
        GM_setClipboard: has('GM_setClipboard'),
        GM_xmlhttpRequest: has('GM_xmlhttpRequest') || (root.GM && typeof root.GM.xmlHttpRequest === 'function'),
        GM_download: has('GM_download')
      },
      gm_info: gmInfo || undefined
    };
  }

  /** Create the base LCMD container (don’t freeze yet; submodules will attach to it). */
  var LCMD = {
    // Versioning
    __version__: '4.0.0-modular',
    __ns_ready__: false,
    __created_at__: Date.now(),
    __last_loaded_at__: Date.now(),

    // Reference to page/global
    __root__: root,

    // Previous global (for noConflict)
    __prev__: EXISTING || null,

    /**
     * Define (or retrieve) a nested namespace path. Won’t clobber existing objects.
     * @param {string} path e.g. "core.config" or "ui"
     * @returns {object} the terminal object at that path
     */
    defineNS: function (path) {
      if (!path || typeof path !== 'string') return this;
      var parts = splitPath(path);
      var node = LCMD;
      for (var i = 0; i < parts.length; i++) {
        var key = parts[i];
        if (!own(node, key) || !isObj(node[key])) node[key] = {};
        node = node[key];
      }
      return node;
    },

    /**
     * Get a nested namespace path (or undefined if any segment is missing).
     * @param {string} path
     * @returns {any}
     */
    getNS: function (path) {
      if (!path || typeof path !== 'string') return undefined;
      var parts = splitPath(path);
      var node = LCMD;
      for (var i = 0; i < parts.length; i++) {
        var key = parts[i];
        if (!own(node, key)) return undefined;
        node = node[key];
      }
      return node;
    },

    /**
     * Restore the previous global LCMD (if any) and return the current object.
     * You can keep a reference to the returned object if you still need it.
     */
    noConflict: function () {
      try { root.LCMD = LCMD.__prev__; } catch (_) {}
      return LCMD;
    },

    /**
     * Shallow-freeze the top-level LCMD object & its primary buckets to avoid accidental reassignment.
     * (Does NOT deep-freeze subtrees so modules can keep adding methods/fields.)
     */
    lock: function () {
      // Freeze only the container & first-level buckets
      try {
        shallowFreeze(LCMD.core);
        shallowFreeze(LCMD.ui);
        shallowFreeze(LCMD.capture);
        shallowFreeze(LCMD.lc_api);
        shallowFreeze(LCMD.md);
        shallowFreeze(LCMD.nb);
        shallowFreeze(LCMD.dom);
        shallowFreeze(LCMD.net);
        shallowFreeze(LCMD.util);
        shallowFreeze(LCMD);
      } catch (_) {}
      LCMD.__locked__ = true;
      return LCMD;
    },

    // Snapshot of runtime capabilities (GM grants, UA, etc.)
    env: detectEnv(),

    // Pre-created buckets (modules attach here)
    core: {},
    ui: {},
    capture: {},
    lc_api: {},
    md: {},
    nb: {},
    dom: {},
    net: {},
    util: {}
  };

  // Attach to global
  try { root.LCMD = LCMD; } catch (_) { /* ignore */ }

  // Mark ready
  LCMD.__ns_ready__ = true;

  // Optionally seal in production by uncommenting:
  // LCMD.lock();
})();
