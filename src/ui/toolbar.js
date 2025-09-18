/* src/ui/toolbar.js
 * Floating toolbar (Copy Report / Save .ipynb / Copy Log + capture badge + toast).
 * - Idempotent: safe to @require multiple times.
 * - Auto-heals via MutationObserver if DOM re-renders.
 * - Reads placement/z-index/toast duration from core.config.
 * - Exposes: ensure({ onCopyReport, onSaveNotebook, onCopyLog }), updateCaptureBadge(), showToast(msg)
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var UI = NS.defineNS('ui');
  if (UI.toolbar && UI.toolbar.__ready__) return;

  var log = (NS.core && NS.core.log) || { info: function(){}, debug: function(){}, warn: function(){}, error: function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;
  var CONFIG = (NS.core && NS.core.config) || {};
  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  /* ----------------------- small utils ----------------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }
  function getSlugFromPath() {
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'problems') return parts[1] || null;
    var i = parts.indexOf('problems'); return (i !== -1 && parts[i+1]) ? parts[i+1] : null;
  }
  var STORE_KEY = 'lc_capture_store_v2';
  function loadStore(){ try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } }
  function getCustomInput(slug){ var o = loadStore()[slug] || {}; return (o.custom && o.custom.value) || ''; }

  /* ----------------------- DOM nodes ----------------------- */
  var $bar = null, $btnReport = null, $btnLog = null, $btnSave = null, $badge = null, $toast = null;
  var _handlers = { onCopyReport: null, onCopyLog: null, onSaveNotebook: null };
  var _mo = null;

  function applyBarStyle() {
    if (!$bar) return;
    var ui = getCfg().ui || {};
    var pos = (ui.toolbar || {});
    $bar.style.position = 'fixed';
    $bar.style.right    = String(pos.right || '16px');
    $bar.style.bottom   = String(pos.bottom || '16px');
    $bar.style.zIndex   = String(pos.zIndex || 999999);
    $bar.style.display  = 'flex';
    $bar.style.gap      = '8px';
    $bar.style.alignItems = 'center';
  }

  function makeBtn(label) {
    var b = document.createElement('button');
    b.textContent = label;
    b.dataset.defaultLabel = label;
    b.dataset.busy = '0';
    b.className = 'lcmd-btn';
    b.style.padding = '10px 12px';
    b.style.borderRadius = '10px';
    b.style.border = '1px solid #ccc';
    b.style.background = '#fff';
    b.style.fontWeight = '600';
    b.style.cursor = 'pointer';
    b.style.boxShadow = '0 2px 10px rgba(0,0,0,0.15)';
    b.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"';
    b.style.whiteSpace = 'nowrap';
    b.addEventListener('mouseenter', function(){ if (b.dataset.busy !== '1') b.style.background = '#f7f7f7'; });
    b.addEventListener('mouseleave', function(){ if (b.dataset.busy !== '1') b.style.background = '#fff'; });
    return b;
  }

  function lockButtonWidth(btn) {
    if (!btn || btn.dataset.minWidthLocked === '1') return;
    requestAnimationFrame(function(){
      if (!btn || !btn.isConnected) return;
      var rect = btn.getBoundingClientRect();
      if (rect && rect.width) {
        btn.style.minWidth = rect.width + 'px';
        btn.dataset.minWidthLocked = '1';
      }
    });
  }

  function setButtonLabel(btn, text) {
    if (!btn) return;
    btn.textContent = text;
  }

  function runHandlerWithBusyState(btn, handler, busyLabel, missingMsg) {
    if (!btn) return;
    if (btn.dataset.busy === '1') return;
    if (typeof handler !== 'function') {
      if (missingMsg) showToast(missingMsg);
      return;
    }
    var original = btn.dataset.defaultLabel || btn.textContent || '';
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.style.background = '#f0f0f0';
    btn.style.cursor = 'progress';
    setButtonLabel(btn, busyLabel);

    var finalize = function(){
      btn.dataset.busy = '0';
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.style.background = '#fff';
      btn.style.cursor = 'pointer';
      setButtonLabel(btn, original);
    };

    var result;
    try {
      result = handler();
    } catch (err) {
      console.error('[LCMD] toolbar handler error', err);
      finalize();
      return;
    }

    Promise.resolve(result).catch(function(err){
      console.error('[LCMD] toolbar handler rejection', err);
    }).finally(finalize);
  }

  function ensureToast() {
    if ($toast && document.body.contains($toast)) return;
    $toast = document.createElement('div');
    $toast.id = 'lcmd-toast';
    $toast.style.position = 'fixed';
    $toast.style.right = '16px';
    $toast.style.bottom = '64px';
    $toast.style.zIndex = '1000000';
    $toast.style.padding = '10px 14px';
    $toast.style.borderRadius = '10px';
    $toast.style.border = '1px solid #ccc';
    $toast.style.background = '#f9f9f9';
    $toast.style.fontSize = '12px';
    $toast.style.whiteSpace = 'pre-line';
    $toast.style.maxWidth = '560px';
    $toast.style.boxShadow = '0 2px 10px rgba(0,0,0,0.12)';
    $toast.style.display = 'none';
    document.body.appendChild($toast);
  }

  function showToast(msg) {
    ensureToast();
    $toast.textContent = msg;
    $toast.style.display = 'block';
    clearTimeout(showToast._t);
    var dur = ((getCfg().ui || {}).toast || {}).durationMs || 6000;
    showToast._t = setTimeout(function(){ if ($toast) $toast.style.display = 'none'; }, dur);
  }

  function updateCaptureBadge() {
    if (!$badge) return;
    var slug = getSlugFromPath();
    var val = slug && getCustomInput(slug);
    if (nonEmpty(val)) {
      $badge.textContent = 'Custom run: captured ✅';
      $badge.style.borderColor = '#16a34a';
      $badge.style.color = '#166534';
      $badge.style.background = '#dcfce7';
    } else {
      $badge.textContent = 'Custom run: not captured yet';
      $badge.style.borderColor = '#ccc';
      $badge.style.color = '#555';
      $badge.style.background = '#fff';
    }
  }

  function wireHandlers() {
    if ($btnReport) {
      $btnReport.onclick = function () {
        runHandlerWithBusyState($btnReport, _handlers.onCopyReport, 'Copying…', 'No handler connected for Copy Report.');
      };
    }
    if ($btnLog) {
      $btnLog.onclick = function () {
        runHandlerWithBusyState($btnLog, _handlers.onCopyLog, 'Copying…', 'No handler connected for Copy Log.');
      };
    }
    if ($btnSave) {
      $btnSave.onclick = function () {
        runHandlerWithBusyState($btnSave, _handlers.onSaveNotebook, 'Saving…', 'No handler connected for Save .ipynb.');
      };
    }
  }

  function injectBar() {
    if ($bar && document.body.contains($bar)) return;

    $bar = document.createElement('div');
    $bar.id = 'lcmd-toolbar';
    applyBarStyle();

    $btnReport = makeBtn('Copy Report');
    $btnSave   = makeBtn('Save .ipynb');
    $btnLog    = makeBtn('Copy Log');

    $badge = document.createElement('span');
    $badge.style.fontSize = '12px';
    $badge.style.padding = '4px 8px';
    $badge.style.borderRadius = '999px';
    $badge.style.border = '1px solid #ccc';
    $badge.style.background = '#fff';
    $badge.style.color = '#555';
    $badge.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"';
    $badge.textContent = 'Custom run: not captured yet';

    $bar.appendChild($btnReport);
    $bar.appendChild($btnSave);
    $bar.appendChild($btnLog);
    $bar.appendChild($badge);

    document.body.appendChild($bar);
    lockButtonWidth($btnReport);
    lockButtonWidth($btnSave);
    lockButtonWidth($btnLog);
    ensureToast();
    wireHandlers();
    updateCaptureBadge();

    // Observe DOM reshuffles and re-attach if our bar gets removed
    if (_mo) try { _mo.disconnect(); } catch (_) {}
    _mo = new MutationObserver(function () {
      if (!$bar || !document.body.contains($bar)) {
        // Re-inject and re-wire
        injectBar();
      }
    });
    try { _mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}
  }

  function handleConfigChanged() {
    applyBarStyle();
  }

  function attachLocationChangeListener() {
    // If the site is SPA, update badge on location changes (history patched by dom.ready if present)
    root.addEventListener('locationchange', updateCaptureBadge);
    root.addEventListener('popstate', updateCaptureBadge);
  }

  /* ----------------------- Public API ----------------------- */
  var API = {
    __ready__: true,

    /**
     * Ensure the toolbar exists and wire handlers.
     * @param {{onCopyReport?:Function, onCopyLog?:Function, onSaveNotebook?:Function}} handlers
     */
    ensure: function (handlers) {
      _handlers.onCopyReport  = handlers && handlers.onCopyReport  || _handlers.onCopyReport;
      _handlers.onCopyLog     = handlers && handlers.onCopyLog     || _handlers.onCopyLog;
      _handlers.onSaveNotebook= handlers && handlers.onSaveNotebook|| _handlers.onSaveNotebook;

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function once(){ document.removeEventListener('DOMContentLoaded', once); injectBar(); attachLocationChangeListener(); }, { once: true });
      } else {
        injectBar();
        attachLocationChangeListener();
      }

      // React to config updates (e.g., position/zIndex)
      try { document.addEventListener('lcmd:config-changed', handleConfigChanged); } catch (_) {}

      log.info('toolbar ready');
    },

    /** Update the “custom run captured” badge based on session store. */
    updateCaptureBadge: updateCaptureBadge,

    /** Show a small toast in the corner. */
    showToast: showToast
  };

  UI.toolbar = API;

})(window.LCMD);
