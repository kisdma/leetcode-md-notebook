/* src/util/index.js
 * Utility namespace aggregator / compatibility helpers.
 *
 * Public API (LCMD.util.index):
 *   ensure(path) -> namespace object | null
 *   has(key) -> boolean
 *   list() -> string[] (immediate keys under LCMD.util)
 *   get(key) -> any
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;

  var UTIL = NS.defineNS('util');
  var existing = UTIL.index;
  if (existing && existing.__ready__) return;

  // Attach submodules (assumes individual files self-register under LCMD.util.*)
  // Nothing to do here if each module already sets UTIL.something = {__ready__:true,...}

  // ---- Back-compat aliases (planned names) ----
  // url: makeAbsoluteUrl -> absolute
  if (UTIL.url && !UTIL.url.makeAbsoluteUrl) {
    UTIL.url.makeAbsoluteUrl = UTIL.url.absolute;
  }

  // parse: ensure planned file exposes numbers helpers
  // (If you import numbers.js internally, parse.js already forwards them)

  // guards: expose ensureSingleInit also via UTIL.guards
  if (!UTIL.guards && NS.dom && NS.dom.ready && NS.dom.ready.ensureSingleInit) {
    UTIL.guards = {
      __ready__: true,
      ensureSingleInit: NS.dom.ready.ensureSingleInit,
      isSameOriginFrame: function(iframeEl){
        try { void (iframeEl && iframeEl.contentDocument); return true; } catch(_) { return false; }
      },
      listSameOriginFrames: function(root){
        root = root || document;
        var ifr = Array.prototype.slice.call(root.querySelectorAll('iframe'));
        var out = [];
        for (var i=0;i<ifr.length;i++){
          var f = ifr[i];
          try { void f.contentDocument; out.push({ el:f, win:f.contentWindow, doc:f.contentDocument }); } catch(_){}
        }
        return out;
      }
    };
  }

  // string: ensure the file is named string.js (not strings.js)
  // (If you previously had strings.js, keep a re-export stub there or rename the file.)

  var API = {
    __ready__: true,
    ensure: function(path){
      if (!path || typeof path !== 'string') return null;
      try { return NS.defineNS(path); } catch (_) { return null; }
    },
    has: function(key){ return !!(key && Object.prototype.hasOwnProperty.call(UTIL, key)); },
    list: function(){ try { return Object.keys(UTIL); } catch (_) { return []; } },
    get: function(key){ return key ? UTIL[key] : undefined; }
  };

  UTIL.index = API;

})(window.LCMD);
