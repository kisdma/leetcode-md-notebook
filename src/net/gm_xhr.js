/* src/net/gm_xhr.js
 * Greasemonkey/Tampermonkey cross-origin requests with graceful fallbacks.
 *
 * Responsibilities:
 *  - Provide a thin, Promise-based wrapper over GM_xmlhttpRequest / GM.xmlHttpRequest
 *  - Fallback to window.fetch when GM XHR is unavailable or same-origin is fine
 *  - Convenience helpers for common patterns (JSON, ArrayBuffer, DataURL images)
 *
 * Public API (LCMD.net.gm_xhr):
 *   isAvailable() -> boolean
 *   absoluteUrl(u, base?) -> string
 *   getCookie(name) -> string
 *
 *   request(opts) -> Promise<GmResponse>
 *     opts: {
 *       method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD',
 *       url: string,
 *       headers?: Record<string,string>,
 *       data?: string|ArrayBuffer|Blob|FormData,   // GM uses "data"
 *       body?:  string|ArrayBuffer|Blob|FormData,  // alias; normalized to "data"
 *       timeout?: number,                          // ms
 *       responseType?: 'text'|'json'|'arraybuffer'|'blob',
 *       binary?: boolean,                          // legacy GM flag for ArrayBuffer
 *       withCredentials?: boolean
 *     }
 *     GmResponse: {
 *       ok: boolean, status: number, statusText: string,
 *       response: any,                             // depends on responseType
 *       responseHeaders: string,                   // raw header string
 *       headers: Record<string,string>,            // parsed headers (lowercased)
 *       finalUrl: string
 *     }
 *
 *   get(url, {headers, responseType, timeout}) -> Promise<GmResponse>
 *   post(url, body, {headers, responseType, timeout}) -> Promise<GmResponse>
 *
 *   json(url, init?) -> Promise<any>             // GET JSON (GM if available else fetch)
 *   fetchAsDataURL(url, timeoutMs=20000) -> Promise<{ok:boolean, dataUrl:string, mime:string, size:number, error?:string}>
 *
 * Notes:
 *  - Requires @grant GM_xmlhttpRequest (or GM.xmlHttpRequest) and @connect * for cross-origin.
 *  - When falling back to fetch, we try to emulate the same contract where practical.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var NET = NS.defineNS('net');
  var existing = NET.gm_xhr || NET.gm;
  if (existing && existing.__ready__) return;

  var log = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };

  /* -------------------------------- helpers -------------------------------- */

  function isAvailable(){
    try {
      return (typeof GM_xmlhttpRequest === 'function') ||
             (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function');
    } catch(_) { return false; }
  }

  function absoluteUrl(u, base){
    try { return new URL(u, base || location.href).href; } catch(_) { return String(u || ''); }
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

  function arrayBufferToBase64(ab){
    var bytes = new Uint8Array(ab || []);
    var chunk = 0x8000;
    var binary = '';
    for (var i=0; i<bytes.length; i+=chunk){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
    }
    // btoa expects binary string
    return (typeof btoa === 'function') ? btoa(binary) : '';
  }

  function blobToDataURL(blob){
    return new Promise(function(resolve, reject){
      try{
        var fr = new FileReader();
        fr.onload = function(){ resolve(fr.result); };
        fr.onerror = function(){ reject(new Error('FileReader error')); };
        fr.readAsDataURL(blob);
      }catch(e){ reject(e); }
    });
  }

  function parseHeadersString(raw){
    var out = Object.create(null);
    if (!raw) return out;
    var lines = String(raw).split(/\r?\n/);
    for (var i=0;i<lines.length;i++){
      var m = lines[i].match(/^\s*([^:]+):\s*(.+)\s*$/);
      if (!m) continue;
      var k = m[1].toLowerCase();
      if (!(k in out)) out[k] = m[2];
    }
    return out;
  }

  /* ------------------------------- core call ------------------------------- */

  function _gmCall(options){
    return new Promise(function(resolve, reject){
      var fn = (typeof GM_xmlhttpRequest === 'function')
        ? GM_xmlhttpRequest
        : (GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);

      if (!fn){
        reject(new Error('GM_xmlhttpRequest not available'));
        return;
      }

      var respType = options.responseType || 'text';
      var gmOpts = {
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || {},
        data: options.body != null ? options.body : options.data,
        timeout: options.timeout || 0,
        responseType: respType === 'arraybuffer' ? 'arraybuffer'
                     : respType === 'blob' ? 'arraybuffer' // GM returns AB; we convert to Blob if requested
                     : 'text',
        binary: options.binary || (respType === 'arraybuffer' || respType === 'blob') || false,
        fetch: true, // Prefer the modern fetch-backed implementation when available
        withCredentials: !!options.withCredentials,
        onload: function(r){
          try{
            var headers = parseHeadersString(r.responseHeaders || '');
            var response = r.response;
            var status = r.status || 0;
            var ok = status >= 200 && status < 300;

            // Convert ArrayBuffer to Blob if requested
            if (respType === 'blob' && response && response.byteLength != null){
              try {
                var mime = headers['content-type'] || 'application/octet-stream';
                response = new Blob([response], { type: mime });
              } catch(_) {}
            }

            // JSON parse if requested
            if (respType === 'json') {
              try { response = JSON.parse(typeof response === 'string' ? response : new TextDecoder().decode(response)); }
              catch(e){ ok = false; }
            }

            resolve({
              ok: ok,
              status: status,
              statusText: r.statusText || '',
              response: response,
              responseHeaders: r.responseHeaders || '',
              headers: headers,
              finalUrl: r.finalUrl || options.url
            });
          }catch(e){ reject(e); }
        },
        onerror: function(e){ reject(new Error(e && (e.error || e.details || 'GM_xhr error'))); },
        ontimeout: function(){ reject(new Error('GM_xhr timeout')); }
      };

      try { fn(gmOpts); } catch(e){ reject(e); }
    });
  }

  function _fetchCall(options){
    return new Promise(function(resolve, reject){
      var url = options.url;
      var init = {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body != null ? options.body : options.data,
        credentials: options.withCredentials ? 'include' : 'same-origin'
      };

      var to;
      var aborted = false;
      if (options.timeout && options.timeout > 0) {
        to = setTimeout(function(){ aborted = true; reject(new Error('fetch timeout')); }, options.timeout);
      }

      fetch(url, init).then(function(res){
        if (to) clearTimeout(to);
        if (aborted) return;
        var status = res.status;
        var ok = res.ok;
        var respType = options.responseType || 'text';

        var p = (respType === 'arraybuffer') ? res.arrayBuffer()
              : (respType === 'blob')       ? res.blob()
              : (respType === 'json')       ? res.json().catch(function(){ ok=false; return null; })
                                            : res.text();

        p.then(function(body){
          var headers = Object.create(null);
          try {
            res.headers.forEach(function(v, k){ headers[String(k).toLowerCase()] = v; });
          } catch(_) {}
          resolve({
            ok: ok,
            status: status,
            statusText: res.statusText || '',
            response: body,
            responseHeaders: '', // not available in fetch as raw string
            headers: headers,
            finalUrl: res.url || url
          });
        }).catch(reject);
      }).catch(reject);
    });
  }

  /**
   * request(): Use GM XHR when available; otherwise use fetch.
   * For cross-origin endpoints on Tampermonkey, GM is strongly preferred.
   */
  function request(opts){
    opts = opts || {};
    if (isAvailable()) {
      return _gmCall(opts).catch(function(e){
        // Fallback to fetch if GM failed for some reason but we can still try same-origin
        log.warn('[net.gm] GM request failed; attempting fetch fallback:', e && e.message || e);
        return _fetchCall(opts);
      });
    } else {
      return _fetchCall(opts);
    }
  }

  function get(url, options){
    options = options || {};
    options.method = 'GET';
    options.url = url;
    return request(options);
  }

  function post(url, body, options){
    options = options || {};
    options.method = options.method || 'POST';
    options.url = url;
    if (options.body == null && options.data == null) options.body = body;
    return request(options);
  }

  async function json(url, init){
    var opt = Object.assign({ responseType: 'json' }, init || {}, { url: url });
    var r = await request(opt);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.response;
  }

  /**
   * fetchAsDataURL(): robust image downloader to Data URL.
   * Tries GM first (arraybuffer), then fetch() as a fallback.
   */
  async function fetchAsDataURL(url, timeoutMs){
    timeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 20000;
    var abs = absoluteUrl(url);

    // 1) GM path
    if (isAvailable()){
      try{
        var r = await request({ method:'GET', url:abs, responseType:'arraybuffer', timeout: timeoutMs });
        if (r.ok && r.response && r.response.byteLength != null){
          var mime = r.headers['content-type'] || 'application/octet-stream';
          var b64 = arrayBufferToBase64(r.response);
          if (b64) return { ok:true, dataUrl: 'data:' + mime + ';base64,' + b64, mime: mime, size: r.response.byteLength };
        }
      }catch(e){
        log.warn('[net.gm] GM image fetch failed; falling back to fetch():', e && e.message || e);
      }
    }

    // 2) Fetch fallback
    try{
      var res = await _fetchCall({ method:'GET', url:abs, responseType:'blob', timeout: timeoutMs });
      if (!res.ok || !res.response) return { ok:false, dataUrl:'', mime:'', size:0, error:'HTTP '+res.status };
      var blob = res.response;
      var dataUrl = await blobToDataURL(blob);
      return { ok:true, dataUrl: dataUrl, mime: blob.type || 'application/octet-stream', size: blob.size || 0 };
    }catch(e){
      return { ok:false, dataUrl:'', mime:'', size:0, error: e && e.message || 'fetch failed' };
    }
  }

  /* -------------------------------- export -------------------------------- */
  var API = {
    __ready__: true,
    isAvailable: isAvailable,
    absoluteUrl: absoluteUrl,
    getCookie: getCookie,
    request: request,
    get: get,
    post: post,
    json: json,
    fetchAsDataURL: fetchAsDataURL
  };

  NET.gm_xhr = API;
  NET.gm = API; // legacy alias

})(window.LCMD);
