/* src/util/parse.js
 * Numeric parsing helpers facade (planned filename).
 *
 * Exposes LeetCode-centric parsers under LCMD.util.num (and LCMD.util.parse alias):
 *   - parseRuntimeMs(x) : "1.2s" | "123 ms" -> 1200 | 123
 *   - parseMemoryMB(x)  : "512kb" | "64 MB" -> 0.5   | 64
 *   - coerceNum(x)      : robust numeric coercion or null
 *   - fmtPct(x)         : finite -> fixed(2), else passthrough
 *
 * If LCMD.util.num already exists (e.g., from numbers.js), we keep it and just
 * ensure LCMD.util.parse points to the same object.
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');

  // If already provided by another module, just alias and exit
  if (UTIL.num && UTIL.num.__ready__) {
    UTIL.parse = UTIL.num; // file-name-friendly alias
    return;
  }

  function fmtPct(x){ return (typeof x === 'number' && isFinite(x)) ? x.toFixed(2) : (x ?? ''); }

  function coerceNum(x){
    if (x == null) return null;
    if (typeof x === 'number') return isFinite(x) ? x : null;
    var n = parseFloat(String(x).replace(/[^\d.\-+eE]/g,''));
    return isFinite(n) ? n : null;
  }

  function parseRuntimeMs(x){
    if (x == null) return null;
    if (typeof x === 'number') return isFinite(x) ? x : null;
    var s = String(x).trim();
    var m = s.match(/([-+]?\d*\.?\d+)\s*(ms|s)?/i);
    if (!m) return null;
    var v = parseFloat(m[1]); if (!isFinite(v)) return null;
    var u = (m[2] || 'ms').toLowerCase();
    return (u === 's') ? v * 1000 : v;
  }

  function parseMemoryMB(x){
    if (x == null) return null;
    if (typeof x === 'number') return isFinite(x) ? x : null;
    var s = String(x).trim();
    var m = s.match(/([-+]?\d*\.?\d+)\s*(kb|mb|gb|b)?/i);
    if (!m) return null;
    var v = parseFloat(m[1]); if (!isFinite(v)) return null;
    var u = (m[2] || 'mb').toLowerCase();
    if (u === 'b')  return v / 1024 / 1024;
    if (u === 'kb') return v / 1024;
    if (u === 'gb') return v * 1024;
    return v;
  }

  UTIL.num = {
    __ready__: true,
    fmtPct: fmtPct,
    coerceNum: coerceNum,
    parseRuntimeMs: parseRuntimeMs,
    parseMemoryMB: parseMemoryMB
  };

  // Friendly alias matching the file name
  UTIL.parse = UTIL.num;

})(window.LCMD);
