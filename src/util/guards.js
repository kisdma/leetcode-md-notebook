/* src/util/guards.js
 * SPA-safe guards and same-origin iframe helpers (planned filename).
 *
 * Public API (LCMD.util.guards):
 *   ensureSingleInit(flagKey, scope?) -> boolean
 *     - Sets a boolean guard on `scope` (default: unsafeWindow or window).
 *     - Returns true on first call (i.e., proceed), false if already initialized.
 *
 *   isSameOriginFrame(iframeEl) -> boolean
 *     - True if we can access iframe's contentDocument/contentWindow.
 *
 *   listSameOriginFrames(root=document) -> Array<{el, win, doc}>
 *     - Collects all same-origin iframes under `root`.
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  if (UTIL.guards && UTIL.guards.__ready__) return;

  function ensureSingleInit(flagKey, scope){
    scope = scope || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
    try{
      if (scope && scope[flagKey]) return false;
      if (scope) scope[flagKey] = true;
      return true;
    } catch(_){
      // Fall back to window if unsafeWindow write failed
      scope = window;
      if (scope && scope[flagKey]) return false;
      if (scope) scope[flagKey] = true;
      return true;
    }
  }

  function isSameOriginFrame(iframeEl){
    try {
      // Accessing contentDocument will throw on cross-origin frames
      void (iframeEl && iframeEl.contentDocument);
      return true;
    } catch(_) { return false; }
  }

  function listSameOriginFrames(root){
    root = root || document;
    var ifrs;
    try { ifrs = Array.prototype.slice.call(root.querySelectorAll('iframe')); }
    catch(_) { ifrs = []; }
    var out = [];
    for (var i=0;i<ifrs.length;i++){
      var f = ifrs[i];
      if (isSameOriginFrame(f)){
        try { out.push({ el: f, win: f.contentWindow, doc: f.contentDocument }); } catch(_){}
      }
    }
    return out;
  }

  UTIL.guards = {
    __ready__: true,
    ensureSingleInit: ensureSingleInit,
    isSameOriginFrame: isSameOriginFrame,
    listSameOriginFrames: listSameOriginFrames
  };

  // Also surface ensureSingleInit on dom.ready for convenience, if that namespace exists
  if (NS.dom && NS.dom.ready && !NS.dom.ready.ensureSingleInit){
    NS.dom.ready.ensureSingleInit = ensureSingleInit;
  }

})(window.LCMD);
