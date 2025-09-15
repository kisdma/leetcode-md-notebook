/* src/core/config.js
 * Central configuration for LCMD (modifiable at runtime).
 * - Idempotent: safe to load multiple times.
 * - Defaults mirror the monolithic script.
 * - Overrides can come from localStorage (__LCMD_CONFIG_OVERRIDES__) or ?lcmd=<json>.
 * - Emits 'lcmd:config-changed' on updates.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) { return; }

  var root = (function () {
    try { return (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { return window; }
  })();

  var CONFIG_NS = NS.defineNS('core'); // ensure NS.core exists
  var STORE_KEY = '__LCMD_CONFIG_OVERRIDES__';
  var VERSION = NS.__version__ || '4.0.0-modular';

  /* ------------ tiny utils (ES5-friendly) ------------ */
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function clone(x) {
    if (Array.isArray(x)) { return x.slice(); }
    if (isObj(x)) { var o = {}; for (var k in x) if (own(x,k)) o[k] = clone(x[k]); return o; }
    return x;
  }
  function deepMerge(dst, src) {
    if (!isObj(dst) || !isObj(src)) return clone(src);
    var out = {};
    var k;
    for (k in dst) if (own(dst,k)) out[k] = clone(dst[k]);
    for (k in src) if (own(src,k)) {
      var sv = src[k], dv = out[k];
      if (isObj(dv) && isObj(sv)) out[k] = deepMerge(dv, sv);
      else out[k] = clone(sv);
    }
    return out;
  }
  function readLS() {
    try {
      var s = root.localStorage && root.localStorage.getItem(STORE_KEY);
      if (!s) return {};
      return JSON.parse(s) || {};
    } catch (_) { return {}; }
  }
  function writeLS(obj) {
    try {
      if (!obj || (isObj(obj) && Object.keys(obj).length === 0)) {
        root.localStorage && root.localStorage.removeItem(STORE_KEY);
      } else {
        root.localStorage && root.localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      }
    } catch (_) {}
  }
  function parseQueryOverrides() {
    try {
      var q = root.location && root.location.search || '';
      if (!q) return null;
      var m = q.match(/[?&]lcmd=([^&#]+)/);
      if (!m) return null;
      var raw = decodeURIComponent(m[1].replace(/\+/g, '%20'));
      var obj = JSON.parse(raw);
      return isObj(obj) ? obj : null;
    } catch (_) { return null; }
  }
  function eventChanged(snapshot) {
    try { document.dispatchEvent(new CustomEvent('lcmd:config-changed', { detail: snapshot })); } catch (_) {}
  }

  /* ------------ defaults (kept close to original script) ------------ */
  var ORIGIN = (root.location && root.location.origin) || '';

  var DEFAULTS = {
    __version__: VERSION,
    env: {
      origin: ORIGIN
    },

    /* Graph/network */
    network: {
      graphqlEndpoints: [ORIGIN + '/graphql', ORIGIN + '/graphql/'],
      connectAllHosts: true,
      xhrTimeoutMs: 20000
    },

    /* Pagination / submissions */
    limits: {
      MAX_SUBMISSIONS: 60,
      PAGE_SIZE: 20,
      BETWEEN_DETAIL_MS: 160
    },

    /* Editor / Monaco */
    editor: {
      WAIT_MONACO_MS: 9000
    },

    /* Markdown/report */
    md: {
      INCLUDE_LANG_IN_MD: true,
      CODE_BLOCK_COLLAPSE: false,
      CLIP_NOTES_CHARS: 180,
      INLINE_IMAGES: true
    },

    /* Images */
    images: {
      TIMEOUT_MS: 20000
    },

    /* Tracing / logging flags */
    TRACE: {
      MONACO: true,
      STORAGE: true,
      FALLBACK: true,
      IFRAMES: true,
      GLOSSARY_VERBOSE: true
    },

    /* Popup content readiness (glossary descriptions, etc.) */
    CONTENT_READY: {
      MIN_CHARS: 40,
      STABLE_SAMPLES: 3,
      STABLE_GAP_MS: 80,
      TIMEOUT_MS: 1200,
      SEMANTIC_SEL: 'p, ul, ol, li, pre, code, table, strong, em, h1,h2,h3,h4,h5,h6'
    },

    /* Live glossary popup capture */
    GLOSSARY_CFG: {
      HOVER_CLICK_WAIT_MS: 80,
      CLOSE_WAIT_MS: 80,
      PROXIMITY_PX: 500,
      MAX_TERMS: 50,
      OPEN_TIMEOUT_MS: 500
    },

    /* UI (toolbar etc.) */
    ui: {
      toolbar: {
        right: '16px',
        bottom: '16px',
        zIndex: 999999
      },
      toast: {
        durationMs: 6000
      }
    }
  };

  /* ------------ resolve: defaults ⊕ overrides ------------ */
  var _overrides = readLS();
  var _query = parseQueryOverrides();
  if (_query) {
    // Query overrides win (and are persisted so reloads keep the same behavior).
    _overrides = deepMerge(_overrides, _query);
    writeLS(_overrides);
  }

  var _resolved = deepMerge(DEFAULTS, _overrides);

  /* ------------ public API ------------ */
  var API = {
    /**
     * Get a frozen snapshot of the current effective config.
     */
    get: function () {
      // return a defensive clone
      var snap = clone(_resolved);
      try { Object.freeze(snap); } catch (_) {}
      return snap;
    },

    /**
     * Set (merge) overrides. If persist=true, save in localStorage.
     * @param {object} obj
     * @param {boolean} persist
     */
    set: function (obj, persist) {
      if (!isObj(obj)) return API.get();
      _overrides = deepMerge(_overrides, obj);
      if (persist) writeLS(_overrides);
      _resolved = deepMerge(DEFAULTS, _overrides);
      eventChanged(API.get());
      return API.get();
    },

    /**
     * Replace all overrides. If persist=true, save in localStorage.
     * @param {object} obj
     * @param {boolean} persist
     */
    replace: function (obj, persist) {
      _overrides = isObj(obj) ? clone(obj) : {};
      if (persist) writeLS(_overrides); else writeLS({});
      _resolved = deepMerge(DEFAULTS, _overrides);
      eventChanged(API.get());
      return API.get();
    },

    /**
     * Clear overrides entirely.
     */
    reset: function () {
      _overrides = {};
      writeLS({});
      _resolved = clone(DEFAULTS);
      eventChanged(API.get());
      return API.get();
    },

    /**
     * Read overrides from the current URL (?lcmd=<json>). If found, apply+persist.
     */
    loadFromQuery: function () {
      var q = parseQueryOverrides();
      if (!q) return API.get();
      _overrides = deepMerge(_overrides, q);
      writeLS(_overrides);
      _resolved = deepMerge(DEFAULTS, _overrides);
      eventChanged(API.get());
      return API.get();
    }
  };

  // expose
  CONFIG_NS.config = API.get();
  CONFIG_NS.configAPI = API;

})(window.LCMD);
