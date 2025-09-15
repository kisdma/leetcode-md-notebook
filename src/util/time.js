/* src/util/time.js
 * Time helpers: sleep, formatting, throttling/debouncing.
 *
 * Public API (LCMD.util.time):
 *   sleep(ms) -> Promise<void>
 *   nowMs() -> number
 *   toLocalStringFromEpochSec(sec) -> string
 *   formatDurationMs(ms) -> string     // e.g., "1.23s", "85ms"
 *   debounce(fn, wait, {leading=false, trailing=true}) -> Function
 *   throttle(fn, wait) -> Function
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  if (UTIL.time && UTIL.time.__ready__) return;

  function sleep(ms){ return new Promise(function(res){ setTimeout(res, Math.max(0, ms|0)); }); }
  function nowMs(){ return Date.now ? Date.now() : (new Date()).getTime(); }

  function toLocalStringFromEpochSec(sec){
    try { return sec ? new Date(sec * 1000).toLocaleString() : ''; } catch(_) { return ''; }
  }

  function formatDurationMs(ms){
    ms = +ms || 0;
    if (ms >= 1000) return (ms/1000).toFixed(ms < 10_000 ? 2 : 1) + 's';
    return Math.round(ms) + 'ms';
  }

  function debounce(fn, wait, opt){
    opt = opt || {};
    var t = null, lastArgs = null, leadingCalled = false;
    return function(){
      var ctx = this, args = arguments;
      lastArgs = args;
      if (t) clearTimeout(t);
      if (opt.leading && !leadingCalled){
        leadingCalled = true;
        try { fn.apply(ctx, args); } catch(_){}
      }
      t = setTimeout(function(){
        if (opt.trailing !== false && (!opt.leading || leadingCalled)){
          try { fn.apply(ctx, lastArgs); } catch(_){}
        }
        t = null; leadingCalled = false; lastArgs = null;
      }, wait|0);
    };
  }

  function throttle(fn, wait){
    var last = 0, pending = null;
    return function(){
      var ctx = this, args = arguments, now = nowMs();
      var remain = wait - (now - last);
      if (remain <= 0){
        last = now;
        try { fn.apply(ctx, args); } catch(_){}
      } else if (!pending) {
        pending = setTimeout(function(){
          pending = null; last = nowMs();
          try { fn.apply(ctx, args); } catch(_){}
        }, remain);
      }
    };
  }

  UTIL.time = {
    __ready__: true,
    sleep: sleep,
    nowMs: nowMs,
    toLocalStringFromEpochSec: toLocalStringFromEpochSec,
    formatDurationMs: formatDurationMs,
    debounce: debounce,
    throttle: throttle
  };
})(window.LCMD);
