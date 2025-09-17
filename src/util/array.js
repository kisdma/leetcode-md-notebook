/* src/util/array.js
 * Array helpers: uniqueness, chunking, flattening, zipping.
 *
 * Public API (LCMD.util.array):
 *   uniqueBy(array, keyFn) -> any[]
 *   flatten(arr) -> any[]
 *   chunk(arr, size) -> any[][]
 *   zip(a, b) -> [a[i], b[i]][]
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  var existing = UTIL.array || UTIL.arr;
  if (existing && existing.__ready__) return;

  function uniqueBy(arr, keyFn){
    var out = [], seen = Object.create(null);
    for (var i=0;i<(arr||[]).length;i++){
      var it = arr[i], k = String(keyFn ? keyFn(it, i) : it);
      if (seen[k]) continue;
      seen[k] = 1; out.push(it);
    }
    return out;
  }

  function flatten(arr){ return [].concat.apply([], arr || []); }

  function chunk(arr, size){
    size = size|0; if (size <= 0) size = 1;
    var out = [];
    for (var i=0;i<(arr||[]).length;i+=size) out.push((arr||[]).slice(i, i+size));
    return out;
  }

  function zip(a, b){
    var n = Math.min((a||[]).length, (b||[]).length), out = new Array(n);
    for (var i=0;i<n;i++) out[i] = [a[i], b[i]];
    return out;
  }

  var API = { __ready__: true, uniqueBy: uniqueBy, flatten: flatten, chunk: chunk, zip: zip };

  UTIL.array = API;
  UTIL.arr = API; // legacy alias
})(window.LCMD);
