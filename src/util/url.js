/* src/util/url.js
 * URL helpers, using LCMD.net.gm.absoluteUrl when available.
 *
 * Public API (LCMD.util.url):
 *   absolute(u, base?) -> string
 *   isHttpUrl(u) -> boolean
 *   join(base, path) -> string
 *   getCookie(name) -> string
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  if (UTIL.url && UTIL.url.__ready__) return;

  function absolute(u, base){
    try {
      if (NS.net && NS.net.gm && typeof NS.net.gm.absoluteUrl === 'function') {
        return NS.net.gm.absoluteUrl(u, base);
      }
      return new URL(u, base || location.href).href;
    } catch(_){ return String(u || ''); }
  }

  function isHttpUrl(u){
    try { var h = new URL(u, location.href); return /^https?:$/.test(h.protocol); }
    catch(_){ return false; }
  }

  function join(base, path){
    try { return new URL(path, base).href; } catch(_){ return String((base||'') + (path||'')); }
  }

  function getCookie(name){
    try{
      var pairs = document.cookie ? document.cookie.split('; ') : [];
      for (var i=0;i<pairs.length;i++){
        var kv = pairs[i].split('=');
        if (kv[0] === name) return kv[1] || '';
      }
      return '';
    } catch(_) { return ''; }
  }

  UTIL.url = {
    __ready__: true,
    absolute: absolute,
    isHttpUrl: isHttpUrl,
    join: join,
    getCookie: getCookie
  };
})(window.LCMD);
