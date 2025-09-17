/* src/capture/monaco_top.js
 * Page-top Monaco dumper.
 * - Injects a page-context listener for 'lc-monaco-request-top'
 *   and responds with 'lc-monaco-dump-top' { code, langId, __info }.
 * - Heuristics: pick focused editor → visible editor → first → largest model.
 * - Public API:
 *     LCMD.capture.monaco_top.install()
 *     LCMD.capture.monaco_top.request(timeoutMs=1200) -> Promise<{code,langId,__info}>
 * - Idempotent and CSP-tolerant (logs a warning if injection seems blocked).
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var CAP = NS.defineNS('capture');
  var existing = CAP.monaco_top || CAP.monacoTop;
  if (existing && existing.__ready__) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var log = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };

  /* ------------------------ injection payload ------------------------ */
  function buildInjectionCode() {
    // Keep ES5 to run inside page context on older engines.
    return '(' + (function () {
      try {
        if (window.__LC_MONACO_DUMP_TOP__) return;
        window.__LC_MONACO_DUMP_TOP__ = true;

        function isVis(node) {
          try {
            if (!node) return false;
            var r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && document.contains(node);
          } catch (e) { return false; }
        }

        function pickEditor(M) {
          var eds = (M && M.editor && M.editor.getEditors) ? M.editor.getEditors() : [];
          var i, e;
          for (i = 0; i < eds.length; i++) {
            e = eds[i];
            try { if (e && e.hasTextFocus && e.hasTextFocus()) return e; } catch (_){}
          }
          for (i = 0; i < eds.length; i++) {
            e = eds[i];
            try {
              var n = e && e.getDomNode && e.getDomNode();
              if (isVis(n)) return e;
            } catch (_){}
          }
          return eds[0] || null;
        }

        window.addEventListener('lc-monaco-request-top', function () {
          try {
            var M = window.monaco;
            var code = '', langId = '', info = { where: 'top' };

            if (M && M.editor) {
              var eds    = M.editor.getEditors ? M.editor.getEditors() : [];
              var models = M.editor.getModels  ? M.editor.getModels()  : [];
              var focused = false, visible = false;

              try {
                var i, e;
                for (i = 0; i < eds.length; i++) { e = eds[i]; if (e && e.hasTextFocus && e.hasTextFocus()) { focused = true; break; } }
                for (i = 0; i < eds.length; i++) { e = eds[i]; var n = e && e.getDomNode && e.getDomNode(); if (isVis(n)) { visible = true; break; } }
              } catch (_){}

              var ed = pickEditor(M);
              var model = (ed && ed.getModel) ? ed.getModel() : null;

              if (!model && models && models.length) {
                // Pick the largest model as a last resort
                var best = null, bestLen = -1;
                for (var k = 0; k < models.length; k++) {
                  var m = models[k];
                  var v = (m && m.getValue) ? m.getValue() : '';
                  var L = v ? v.length : 0;
                  if (L > bestLen) { bestLen = L; best = m; }
                }
                model = best;
              }

              if (model) {
                try { code   = (model.getValue && model.getValue()) || ''; } catch (_){}
                try { langId = (model.getLanguageId && model.getLanguageId()) || ''; } catch (_){}
              }

              info = {
                where: 'top',
                editors: eds.length,
                models: models.length,
                focused: focused,
                visible: visible,
                chose: focused ? 'focused' : (visible ? 'visible' : (eds[0] ? 'first' : 'none')),
                modelLen: (code || '').length,
                langId: langId
              };
            } else {
              info = { where: 'top', monaco: false };
            }

            document.dispatchEvent(new CustomEvent('lc-monaco-dump-top', {
              detail: { code: code, langId: langId, __info: info }
            }));
          } catch (e) {
            document.dispatchEvent(new CustomEvent('lc-monaco-dump-top', {
              detail: { code: '', langId: '', __info: { where: 'top', error: String((e && e.message) || e) } }
            }));
          }
        });
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
      log.warn('monaco_top: injection failed (CSP?)', e && (e.message || e));
      return false;
    }
  }

  /* ------------------------ public API ------------------------ */
  var API = {
    __ready__: true,

    /** Inject the page-context listener once. Safe to call repeatedly. */
    install: function () {
      if (root.__LC_MONACO_DUMP_TOP__ || (root.window && root.window.__LC_MONACO_DUMP_TOP__)) return;
      var ok = injectIntoPage(buildInjectionCode());
      if (ok) log.debug('monaco_top: injected');
    },

    /**
     * Request a Monaco dump from the top document.
     * @param {number} timeoutMs (default 1200)
     * @returns {Promise<{code:string, langId:string, __info:object}>}
     */
    request: function (timeoutMs) {
      var T = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 1200;

      // Ensure injected
      try { API.install(); } catch (_){}

      return new Promise(function (resolve) {
        var done = false;
        var to = null;

        function cleanup() {
          if (done) return;
          done = true;
          try { document.removeEventListener('lc-monaco-dump-top', onDump, true); } catch (_){}
          if (to) clearTimeout(to);
        }

        function onDump(ev) {
          cleanup();
          try {
            var data = (ev && ev.detail) || { code:'', langId:'', __info:{} };
            resolve(data);
          } catch (_){
            resolve({ code:'', langId:'', __info:{ where:'top', error:'handler' } });
          }
        }

        try { document.addEventListener('lc-monaco-dump-top', onDump, { once: true, capture: true }); } catch (_){
          // Fallback if once/capture unsupported
          try { document.addEventListener('lc-monaco-dump-top', onDump); } catch (_){}
        }

        // Fire the request into page context
        try { document.dispatchEvent(new Event('lc-monaco-request-top')); } catch (_){
          // Older browsers
          var evt;
          try { evt = document.createEvent('Event'); evt.initEvent('lc-monaco-request-top', true, true); document.dispatchEvent(evt); } catch (__){}
        }

        to = setTimeout(function () {
          cleanup();
          resolve({ code:'', langId:'', __info:{ where:'top', timeout:true } });
        }, T);
      });
    }
  };

  CAP.monaco_top = API;
  CAP.monacoTop = API; // legacy alias

})(window.LCMD);
