/* src/util/json.js
 * Safe JSON utilities and cloning helpers.
 *
 * Public API (LCMD.util.json):
 *   safeParse(str, fallback=null) -> any
 *   tryStringify(val, fallback='[]') -> string
 *   stableStringify(obj) -> string
 *   deepClone(obj) -> any
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  if (UTIL.json && UTIL.json.__ready__) return;

  function safeParse(s, fb){
    try { return JSON.parse(s); } catch(_) { return fb; }
  }
  function tryStringify(v, fb){
    try { return JSON.stringify(v); } catch(_) { return fb; }
  }
  function stableStringify(obj){
    var cache = new Set();
    var out = JSON.stringify(obj, function(k,v){
      if (v && typeof v === 'object'){
        if (cache.has(v)) return '[Circular]';
        cache.add(v);
        if (!Array.isArray(v)){
          var o = {};
          Object.keys(v).sort().forEach(function(key){ o[key] = v[key]; });
          return o;
        }
      }
      return v;
    });
    cache.clear();
    return out;
  }
  function deepClone(obj){
    try { return structuredClone ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)); }
    catch(_){ return obj; }
  }

  UTIL.json = {
    __ready__: true,
    safeParse: safeParse,
    tryStringify: tryStringify,
    stableStringify: stableStringify,
    deepClone: deepClone
  };
})(window.LCMD);
