/* src/dom/ready.js
 * DOM readiness, element-waiters, and lightweight SPA navigation hooks.
 *
 * Public API (LCMD.dom.ready):
 *   onReady(fn)                                  -> void           // DOMContentLoaded (or immediately)
 *   onLoad(fn)                                   -> void           // window 'load'
 *   onIdle(fn, {timeout=1000})                   -> void           // requestIdleCallback w/ fallback
 *
 *   waitForElement(selector, opts?)              -> Promise<Element|null>
 *     opts: {
 *       root?: Document|Element = document,      // search root
 *       timeout?: number = 10000,                // ms; 0/false => no timeout
 *       subtree?: boolean = true,                // observe subtree
 *       visible?: boolean = false,               // require isVisible(el)
 *       signal?: AbortSignal                      // optional abort
 *     }
 *
 *   once(target, type, fn, opts?)                -> () => void     // addEventListener once; returns off()
 *   isVisible(el)                                -> boolean        // display/visibility/size check
 *
 *   patchHistory({dispatch=true})                -> () => void     // monkey-patch pushState/replaceState to emit 'locationchange'
 *   onLocationChange(fn)                         -> () => void     // subscribe to 'locationchange'
 *
 *   ensureSingleInit(flagKey, scope?)            -> boolean        // SPA-safe init guard on a scope (window by default)
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var DOM = NS.defineNS('dom');
  if (DOM.ready && DOM.ready.__ready__) return;

  /* ------------------------------- utils ------------------------------- */

  function onReady(fn){
    try{
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once:true });
      } else {
        fn();
      }
    } catch(_) { /* noop */ }
  }

  function onLoad(fn){
    try{
      if (document.readyState === 'complete') {
        fn();
      } else {
        window.addEventListener('load', fn, { once:true });
      }
    } catch(_) { /* noop */ }
  }

  // requestIdleCallback with fallback to setTimeout
  var ric = window.requestIdleCallback || function(cb, opt){
    var t = (opt && typeof opt.timeout === 'number') ? opt.timeout : 1;
    return setTimeout(function(){ cb({ didTimeout:false, timeRemaining:function(){ return 0; } }); }, t);
  };
  var cic = window.cancelIdleCallback || function(id){ clearTimeout(id); };

  function onIdle(fn, opt){
    var id = ric(function(){ try{ fn(); } catch(_){} }, opt && { timeout: opt.timeout || 1000 });
    return function(){ try{ cic(id); } catch(_){} };
  }

  function once(target, type, fn, opts){
    if (!target || !type || !fn) return function(){};
    var wrapped = function(ev){ try{ fn(ev); } finally { off(); } };
    target.addEventListener(type, wrapped, opts);
    function off(){ try{ target.removeEventListener(type, wrapped, opts); } catch(_){} }
    return off;
  }

  function isVisible(el){
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /**
   * Wait for an element to appear in the DOM matching `selector`.
   * Resolves immediately if it already exists (and visible if `visible:true`).
   */
  function waitForElement(selector, opts){
    opts = opts || {};
    var root    = opts.root || document;
    var timeout = typeof opts.timeout === 'number' ? opts.timeout : 10000;
    var subtree = ('subtree' in opts) ? !!opts.subtree : true;
    var requireVisible = !!opts.visible;
    var signal = opts.signal;

    function pick(){
      try {
        var el = root.querySelector(selector);
        if (!el) return null;
        if (requireVisible && !isVisible(el)) return null;
        return el;
      } catch(_) { return null; }
    }

    var found = pick();
    if (found) return Promise.resolve(found);

    return new Promise(function(resolve){
      var done = false, to = null, mo = null;

      function cleanup(val){
        if (done) return;
        done = true;
        try{ mo && mo.disconnect(); } catch(_){}
        if (to) clearTimeout(to);
        resolve(val);
      }

      // Timeout, if requested
      if (timeout && timeout > 0){
        to = setTimeout(function(){ cleanup(null); }, timeout);
      }

      // Abort support
      if (signal && typeof signal.addEventListener === 'function'){
        signal.addEventListener('abort', function(){ cleanup(null); }, { once:true });
      }

      // Observe mutations
      try{
        mo = new MutationObserver(function(){
          var el = pick();
          if (el) cleanup(el);
        });
        mo.observe(root === document ? document.documentElement : root, { childList:true, subtree:subtree, attributes:false });
      } catch(_){
        // Fallback: poll briefly
        var poll = setInterval(function(){
          var el = pick();
          if (el){ clearInterval(poll); cleanup(el); }
        }, 50);
        if (timeout && timeout > 0){
          setTimeout(function(){ clearInterval(poll); cleanup(null); }, timeout);
        }
      }
    });
  }

  /* ----------------------- SPA navigation helpers ---------------------- */

  /**
   * Patch history.pushState/replaceState and popstate to dispatch a 'locationchange' event on window.
   * Returns an undo function to restore originals (best effort).
   */
  function patchHistory(opts){
    opts = opts || {};
    var dispatch = ('dispatch' in opts) ? !!opts.dispatch : true;

    var push = history.pushState;
    var repl = history.replaceState;

    function fire(){
      if (!dispatch) return;
      try { window.dispatchEvent(new Event('locationchange')); } catch(_){}
    }

    history.pushState = function(){
      var r = push.apply(this, arguments);
      fire();
      return r;
    };
    history.replaceState = function(){
      var r = repl.apply(this, arguments);
      fire();
      return r;
    };
    window.addEventListener('popstate', fire);

    // undo
    return function undo(){
      try { history.pushState = push; } catch(_){}
      try { history.replaceState = repl; } catch(_){}
      try { window.removeEventListener('popstate', fire); } catch(_){}
    };
  }

  function onLocationChange(fn){
    if (!fn) return function(){};
    window.addEventListener('locationchange', fn);
    return function(){ try{ window.removeEventListener('locationchange', fn); } catch(_){} };
  }

  /**
   * Ensure a module initializes only once per SPA session.
   * Stores the guard on `scope` (default: window).
   * Returns true on first call (i.e., proceed), false if already initialized.
   */
  function ensureSingleInit(flagKey, scope){
    scope = scope || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
    try{
      if (scope && scope[flagKey]) return false;
      if (scope) scope[flagKey] = true;
      return true;
    } catch(_){
      // Fall back to global window if unsafeWindow blocked
      scope = window;
      if (scope && scope[flagKey]) return false;
      if (scope) scope[flagKey] = true;
      return true;
    }
  }

  /* ------------------------------- export ------------------------------ */
  DOM.ready = {
    __ready__: true,
    onReady: onReady,
    onLoad: onLoad,
    onIdle: onIdle,
    waitForElement: waitForElement,
    once: once,
    isVisible: isVisible,
    patchHistory: patchHistory,
    onLocationChange: onLocationChange,
    ensureSingleInit: ensureSingleInit
  };

})(window.LCMD);
