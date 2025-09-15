/* src/util/promise.js
 * Promise helpers: deferred, withTimeout, retry with backoff.
 *
 * Public API (LCMD.util.p):
 *   deferred() -> {promise, resolve, reject}
 *   withTimeout(promise, ms, onTimeout?) -> Promise
 *   retry(fn, {tries=3, delay=200, factor=1.5}) -> Promise
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  if (UTIL.p && UTIL.p.__ready__) return;

  function deferred(){
    var resolve, reject;
    var promise = new Promise(function(res, rej){ resolve = res; reject = rej; });
    return { promise: promise, resolve: resolve, reject: reject };
  }

  function withTimeout(p, ms, onTimeout){
    ms = ms|0;
    return new Promise(function(resolve, reject){
      var t = setTimeout(function(){
        try { if (onTimeout) onTimeout(); } catch(_){}
        reject(new Error('timeout '+ms+'ms'));
      }, ms);
      Promise.resolve(p).then(function(v){ clearTimeout(t); resolve(v); }, function(e){ clearTimeout(t); reject(e); });
    });
  }

  async function retry(fn, opt){
    opt = opt || {};
    var tries = opt.tries != null ? opt.tries|0 : 3;
    var delay = opt.delay != null ? opt.delay|0 : 200;
    var factor = typeof opt.factor === 'number' ? opt.factor : 1.5;

    var lastErr;
    for (var i=0;i<tries;i++){
      try { return await fn(i); } catch(e){ lastErr = e; }
      if (i < tries-1) await new Promise(function(res){ setTimeout(res, delay); });
      delay = Math.min(3000, Math.round(delay * factor));
    }
    throw lastErr;
  }

  UTIL.p = { __ready__: true, deferred: deferred, withTimeout: withTimeout, retry: retry };
})(window.LCMD);
