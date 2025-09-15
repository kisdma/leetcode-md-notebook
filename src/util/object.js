/* src/util/object.js
 * Object helpers: pick/omit, deep get/set, shallow merge.
 *
 * Public API (LCMD.util.obj):
 *   pick(obj, keys[]) -> object
 *   omit(obj, keys[]) -> object
 *   merge(target, ...sources) -> target
 *   get(obj, path, fallback) -> any
 *   set(obj, path, value) -> obj
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  if (UTIL.obj && UTIL.obj.__ready__) return;

  function pick(o, keys){
    var out = {};
    (keys||[]).forEach(function(k){ if (o && Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]; });
    return out;
  }
  function omit(o, keys){
    var set = Object.create(null); (keys||[]).forEach(function(k){ set[k]=1; });
    var out = {};
    if (!o) return out;
    Object.keys(o).forEach(function(k){ if (!set[k]) out[k] = o[k]; });
    return out;
  }
  function merge(target){
    target = target || {};
    for (var i=1;i<arguments.length;i++){
      var src = arguments[i];
      if (!src) continue;
      Object.keys(src).forEach(function(k){ target[k] = src[k]; });
    }
    return target;
  }
  function get(obj, path, fb){
    if (!path) return obj;
    var parts = Array.isArray(path) ? path : String(path).split('.');
    var cur = obj, i;
    for (i=0;i<parts.length;i++){
      if (cur == null) return fb;
      cur = cur[parts[i]];
    }
    return cur == null ? fb : cur;
  }
  function set(obj, path, val){
    var parts = Array.isArray(path) ? path : String(path).split('.');
    var cur = obj || {}, i;
    for (i=0;i<parts.length-1;i++){
      var k = parts[i];
      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length-1]] = val;
    return obj;
  }

  UTIL.obj = { __ready__: true, pick: pick, omit: omit, merge: merge, get: get, set: set };
})(window.LCMD);
