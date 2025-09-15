/* src/capture/monaco_frames.js
 * Same-origin iframe Monaco dumper.
 * - Injects a page-context listener inside each same-origin <iframe>.
 * - Frame listener responds to postMessage {type:'lc-monaco-request', id}
 *   with {type:'lc-monaco-dump', id, data:{code,langId,__info:{...}}}.
 * - Public API:
 *     LCMD.capture.monacoFrames.request(timeoutMs=1400)
 *       -> Promise<{code,langId,__info}>
 *     LCMD.capture.monacoFrames.injectAll()  // optional pre-injection
 * - Idempotent and tolerant of CSP/edge cases; no-ops on cross-origin iframes.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var CAP = NS.defineNS('capture');
  if (CAP.monacoFrames && CAP.monacoFrames.__ready__) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var log = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };

  /* ----------------------- helpers ----------------------- */
  function isSameOriginFrame(frameEl) {
    try { void frameEl.contentDocument; return true; } catch (_){ return false; }
  }

  function listSameOriginFrames() {
    var ifr = [];
    try {
      var nodes = document.querySelectorAll('iframe');
      for (var i=0; i<nodes.length; i++) {
        var el = nodes[i];
        if (isSameOriginFrame(el)) {
          try {
            ifr.push({ el: el, win: el.contentWindow, doc: el.contentDocument });
          } catch (_){}
        }
      }
    } catch (_){}
    return ifr;
  }

  function buildInjectionCode() {
    // ES5 stringified function executed inside the *frame* document
    return '(' + (function () {
      try {
        if (window.__LC_MONACO_DUMP_FRAME__) return;
        window.__LC_MONACO_DUMP_FRAME__ = true;

        function isVis(node){
          try {
            if (!node) return false;
            var r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && document.contains(node);
          } catch (_){ return false; }
        }
        function pickEditor(M) {
          var eds = (M && M.editor && M.editor.getEditors) ? M.editor.getEditors() : [];
          var i, e;
          for (i=0;i<eds.length;i++){
            e = eds[i];
            try { if (e && e.hasTextFocus && e.hasTextFocus()) return e; } catch(_){}
          }
          for (i=0;i<eds.length;i++){
            e = eds[i];
            try { var n = e && e.getDomNode && e.getDomNode(); if (isVis(n)) return e; } catch(_){}
          }
          return eds[0] || null;
        }

        window.addEventListener('message', function (ev) {
          try {
            var msg = ev && ev.data;
            if (!msg || msg.type !== 'lc-monaco-request') return;
            var reqId = msg.id || '';
            var M = window.monaco;
            var code = '', langId = '', info = { where:'frame' };

            if (M && M.editor) {
              var eds    = M.editor.getEditors ? M.editor.getEditors() : [];
              var models = M.editor.getModels  ? M.editor.getModels()  : [];
              var focused = false, visible = false;

              try {
                var i, e;
                for (i=0;i<eds.length;i++){ e=eds[i]; if (e && e.hasTextFocus && e.hasTextFocus()) { focused = true; break; } }
                for (i=0;i<eds.length;i++){ e=eds[i]; var n=e && e.getDomNode && e.getDomNode(); if (isVis(n)) { visible = true; break; } }
              } catch(_){}

              var ed = pickEditor(M);
              var model = (ed && ed.getModel) ? ed.getModel() : null;

              if (!model && models && models.length) {
                var best = null, bestLen = -1;
                for (var k=0;k<models.length;k++){
                  var m = models[k];
                  var v = (m && m.getValue) ? m.getValue() : '';
                  var L = v ? v.length : 0;
                  if (L > bestLen) { bestLen = L; best = m; }
                }
                model = best;
              }

              if (model) {
                try { code   = (model.getValue && model.getValue()) || ''; } catch(_){}
                try { langId = (model.getLanguageId && model.getLanguageId()) || ''; } catch(_){}
              }

              info = {
                where: 'frame',
                editors: eds.length,
                models: models.length,
                focused: focused,
                visible: visible,
                chose: focused ? 'focused' : (visible ? 'visible' : (eds[0] ? 'first' : 'none')),
                modelLen: (code || '').length,
                langId: langId
              };
            } else {
              info = { where:'frame', monaco:false };
            }

            window.parent.postMessage({ type:'lc-monaco-dump', id: reqId, data: { code: code, langId: langId, __info: info } }, '*');
          } catch (e) {
            try {
              window.parent.postMessage({ type:'lc-monaco-dump', id: (ev && ev.data && ev.data.id) || '', data: { code:'', langId:'', __info:{ where:'frame', error: String((e && e.message) || e) } } }, '*');
            } catch (_){}
          }
        });
      } catch (_){}
    }).toString() + ')();';
  }

  function injectIntoFrame(frameWin, frameDoc) {
    try {
      if (frameWin.__LC_MONACO_DUMP_FRAME__) return true; // already injected
    } catch(_){ /* keep going; we still try to inject via script tag */ }

    try {
      var s = frameDoc.createElement('script');
      s.textContent = buildInjectionCode();
      frameDoc.documentElement.appendChild(s);
      s.parentNode && s.parentNode.removeChild(s);
      try { frameWin.__LC_MONACO_DUMP_FRAME__ = true; } catch(_){}
      return true;
    } catch (e) {
      log.debug('monaco_frames: inject failed', e && (e.message || e));
      return false;
    }
  }

  function injectAllFrames() {
    var frames = listSameOriginFrames();
    for (var i=0;i<frames.length;i++) {
      try { injectIntoFrame(frames[i].win, frames[i].doc); } catch(_){}
    }
    return frames.length;
  }

  /* ----------------------- public API ----------------------- */
  var API = {
    __ready__: true,

    /** Optional: pre-inject listeners into all same-origin iframes */
    injectAll: injectAllFrames,

    /**
     * Request a Monaco dump from same-origin iframes.
     * Returns the first payload with non-empty code; else the first reply after timeout;
     * or an empty payload if no frames/replies.
     * @param {number} timeoutPer default 1400ms
     * @returns {Promise<{code:string, langId:string, __info:object}>}
     */
    request: function (timeoutPer) {
      var T = (typeof timeoutPer === 'number' && timeoutPer > 0) ? timeoutPer : 1400;
      var frames = listSameOriginFrames();
      if (!frames.length) {
        return Promise.resolve({ code:'', langId:'', __info:{ where:'frames', count:0 } });
      }

      // Ensure injected and send request
      var id = 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);

      return new Promise(function (resolve) {
        var settled = false;
        var first = null;
        var timer = null;

        function cleanup() {
          try { root.removeEventListener('message', onMsg, true); } catch(_){}
          if (timer) clearTimeout(timer);
        }

        function onMsg(ev) {
          try {
            var data = ev && ev.data;
            if (!data || data.type !== 'lc-monaco-dump' || data.id !== id) return;
            if (!first) first = data.data || { code:'', langId:'', __info:{ where:'frames', first:true } };
            var payload = data.data || {};
            if (!settled && payload.code && String(payload.code).trim()) {
              settled = true;
              cleanup();
              resolve(payload);
            }
          } catch (_){}
        }

        try { root.addEventListener('message', onMsg, { capture: true }); } catch (_) { root.addEventListener('message', onMsg); }

        for (var i=0;i<frames.length;i++) {
          var fr = frames[i];
          try {
            injectIntoFrame(fr.win, fr.doc);
            fr.win.postMessage({ type:'lc-monaco-request', id: id }, '*');
          } catch (e) {
            log.debug('monaco_frames: postMessage failed', e && (e.message || e));
          }
        }

        timer = setTimeout(function () {
          cleanup();
          resolve(first || { code:'', langId:'', __info:{ where:'frames', timeout:true } });
        }, T + 200);
      });
    }
  };

  CAP.monacoFrames = API;

})(window.LCMD);
