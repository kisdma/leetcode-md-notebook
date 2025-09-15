/* src/util/numbers.js
 * Numeric parsing/formatting helpers used across modules.
 *
 * Public API (LCMD.util.num):
 *   fmtPct(x) -> string|number         // fixed(2) for finite numbers
 *   coerceNum(x) -> number|null
 *   parseRuntimeMs(x) -> number|null   // "123 ms" | "1.2s" -> ms
 *   parseMemoryMB(x) -> number|null    // "64 MB" | "512kb" -> MB
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  if (UTIL.num && UTIL.num.__ready__) return;

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
})(window.LCMD);
