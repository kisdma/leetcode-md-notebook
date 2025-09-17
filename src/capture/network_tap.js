/* src/capture/network_tap.js
 * Capture user inputs & editor code sent to LeetCode endpoints (Run / Submit / GraphQL).
 * - Idempotent: safe to @require multiple times.
 * - Injects a small script into the page to monkeypatch window.fetch (page context).
 * - Emits window 'lc-input-v2' CustomEvent { customInput, typedCode, lang }.
 * - Public API: LCMD.capture.network_tap.install(cb)
 *   - cb(detailObject) is called for every capture event.
 * - Optional: XHR fallback (disabled by default; see ENABLE_XHR_FALLBACK).
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var CAP = NS.defineNS('capture');
  var existing = CAP.network_tap || CAP.networkTap;
  if (existing && existing.__ready__) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var log = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };

  /** Toggle this to also shim XMLHttpRequest in page context (more invasive). */
  var ENABLE_XHR_FALLBACK = false;

  /* ------------------------ injection payload ------------------------ */
  function buildInjectionCode() {
    // NOTE: Keep this code ES5-compatible; it runs in page context.
    return '(' + (function () {
      try {
        if (window.__LC_NET_TAP_V2__) return;
        window.__LC_NET_TAP_V2__ = true;

        var F = window.fetch;

        function pickFields(text){
          var out = { customInput:'', typedCode:'', lang:'' };
          try{
            if (!text) return out;

            function parseKV(v) {
              var vars = (v && (v.variables || v)) || {};
              out.customInput = vars.input || vars.testCase || vars.testcase || vars.data_input || vars.customInput || out.customInput;
              out.typedCode   = vars.typed_code || vars.code || out.typedCode;
              out.lang        = vars.lang || vars.language || vars.langSlug || out.lang;
            }

            if (typeof text === 'string' && text.charAt(0) === '{'){
              try { parseKV(JSON.parse(text)); } catch (_){}
            } else if (typeof text === 'string') {
              try {
                var p = new URLSearchParams(text);
                out.customInput = p.get('input') || p.get('testCase') || p.get('testcase') || p.get('data_input') || p.get('customInput') || out.customInput;
                out.typedCode   = p.get('typed_code') || p.get('code') || out.typedCode;
                out.lang        = p.get('lang') || p.get('language') || p.get('langSlug') || out.lang;
              } catch (_){}
            } else if (text && typeof text === 'object') {
              parseKV(text);
            }
          } catch (_){}
          return out;
        }

        function shouldTap(url, method) {
          try {
            var m = (method || 'GET').toUpperCase();
            if (m !== 'POST') return false;
            var path = new URL(url, location.href).pathname;
            if ((/\/graphql\/?$/).test(path)) return true;
            if ((/(submissions|interpret|run|judge|execute|check|runcase|submit)/i).test(String(url))) return true;
          } catch (_){}
          return false;
        }

        window.fetch = function(input, init){
          try{
            var url = (typeof input === 'string') ? input : (input && input.url) || '';
            var method = (init && init.method) || (input && input.method) || 'GET';
            if (shouldTap(url, method)) {
              var body = '';
              if (init && typeof init.body === 'string') body = init.body;
              else if (init && init.body && typeof URLSearchParams !== 'undefined' && (init.body instanceof URLSearchParams)) body = init.body.toString();
              else if (init && init.body && typeof FormData !== 'undefined' && (init.body instanceof FormData)) {
                var o={}, it=init.body.entries ? init.body.entries() : null, kv;
                if (it) while ((kv=it.next()) && !kv.done) { o[kv.value[0]] = kv.value[1]; }
                body = JSON.stringify(o);
              } else if (input && input.bodyUsed === false && input.clone && typeof input.clone === 'function') {
                try { body = input.clone().text ? '' : ''; } catch (_){}
              }
              try {
                // If we couldn’t read body from init, and Request.clone().text() path failed synchronously,
                // we still attempt async read after calling original fetch via then() below.
              } catch (_){}
              var picked = pickFields(body);
              if (picked.customInput || picked.typedCode || picked.lang) {
                try { window.dispatchEvent(new CustomEvent('lc-input-v2', { detail: picked })); } catch (_){}
              }
            }
          } catch(_){}
          return F.apply(this, arguments).then(function(res){
            // As a best-effort, if we couldn’t read the request body above, try to infer from a cloned Request (not portable everywhere).
            return res;
          });
        };

        // Optional: XHR fallback (disabled by default; can be enabled by the loader).
        if (window.__LC_NET_TAP_XHR__ === true) {
          try {
            var XHR = window.XMLHttpRequest;
            if (XHR && !XHR.__lcmd_patched__) {
              var _open = XHR.prototype.open;
              var _send = XHR.prototype.send;
              XHR.prototype.open = function(method, url){
                this.__lcmd_url__ = url;
                this.__lcmd_method__ = method;
                return _open.apply(this, arguments);
              };
              XHR.prototype.send = function(body){
                try {
                  if (shouldTap(this.__lcmd_url__, this.__lcmd_method__)) {
                    var text = (typeof body === 'string') ? body : (body && body.toString && body.toString()) || '';
                    var picked = pickFields(text);
                    if (picked.customInput || picked.typedCode || picked.lang) {
                      try { window.dispatchEvent(new CustomEvent('lc-input-v2', { detail: picked })); } catch (_){}
                    }
                  }
                } catch(_){}
                return _send.apply(this, arguments);
              };
              XHR.__lcmd_patched__ = true;
            }
          } catch(_){}
        }
      } catch (_){}
    }).toString() + ')();';
  }

  function injectIntoPage(jsText) {
    try {
      var s = document.createElement('script');
      s.textContent = jsText;
      (document.documentElement || document.head || document.body).appendChild(s);
      s.parentNode && s.parentNode.removeChild(s);
      return true;
    } catch (e) {
      log.debug('network_tap: inject failed', e && (e.message || e));
      return false;
    }
  }

  /* ------------------------ public API ------------------------ */
  var API = {
    __ready__: true,
    /**
     * Install the network tap and subscribe to capture events.
     * @param {(detail:{customInput:string, typedCode:string, lang:string})=>void} onCapture
     * @param {{xhrFallback?:boolean}} [opts]
     */
    install: function (onCapture, opts) {
      opts = opts || {};
      try {
        if (opts.xhrFallback) {
          try { root.__LC_NET_TAP_XHR_REQUEST__ = true; } catch (_) {}
        }
      } catch (_) {}

      // Avoid duplicate listeners
      if (!API.__listenerBound__) {
        try {
          root.addEventListener('lc-input-v2', function (ev) {
            try {
              var detail = (ev && ev.detail) || { customInput:'', typedCode:'', lang:'' };
              if (typeof onCapture === 'function') onCapture(detail);
              // Also fanout via LCMD bus if present
              try { document.dispatchEvent(new CustomEvent('lcmd:capture', { detail: detail })); } catch (_){}
            } catch (e) {
              log.debug('network_tap: callback error', e && (e.message || e));
            }
          });
          API.__listenerBound__ = true;
        } catch (_) {}
      }

      // If already injected in page, do nothing; else inject
      if (!(root.__LC_NET_TAP_V2__ || (root.window && root.window.__LC_NET_TAP_V2__))) {
        // Optionally enable XHR inside page context
        if (opts.xhrFallback || ENABLE_XHR_FALLBACK) {
          try { root.__LC_NET_TAP_XHR__ = true; } catch (_){}
        }
        var ok = injectIntoPage(buildInjectionCode());
        if (!ok) log.warn('network_tap: injection may have failed (CSP?)');
      }

      log.info('network_tap installed');
    },

    /** Fire a synthetic capture event (useful for tests). */
    simulate: function (payload) {
      try { root.dispatchEvent(new CustomEvent('lc-input-v2', { detail: payload || {} })); } catch (_){}
    }
  };

  CAP.network_tap = API;
  CAP.networkTap = API; // legacy alias

})(window.LCMD);
