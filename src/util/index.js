/* src/util/index.js */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;

  // Ensure namespaces
  var UTIL = NS.defineNS('util');

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

})(window.LCMD);
