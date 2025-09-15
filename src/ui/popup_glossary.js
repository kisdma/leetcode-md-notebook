/* src/ui/popup_glossary.js
 * Popover/glossary capture helpers.
 * - clickOpenAndGetHTML(button): open the popup near a glossary term button and return { html, method }.
 * - closeAnyOpenGlossary(): try to close any open popover (Esc) and brief wait.
 * - Utilities exposed for advanced use: isElVisible, popupCandidates, waitForOpenPopup, waitForContentReady.
 * - Uses CONFIG.CONTENT_READY and CONFIG.GLOSSARY_CFG (from core/config.js).
 * - Idempotent: safe to @require multiple times.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var UI = NS.defineNS('ui');
  if (UI.popup_glossary && UI.popup_glossary.__ready__) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;

  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  /* ---------------- helpers ---------------- */
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function isElVisible(el) {
    if (!el) return false;
    try {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) { return false; }
  }

  function popupCandidatesRoot() {
    // Common libraries (Radix, HeadlessUI, Ant, etc.) and LeetCode portals
    return [
      '[role="dialog"]',
      '[role="tooltip"]',
      '[data-radix-popper-content-wrapper]',
      '[data-portal] [role="dialog"]',
      '[data-portal] [role="tooltip"]',
      '[data-portal] [data-state="open"]',
      '[data-state="open"]'
    ].join(',');
  }

  function popupCandidates() {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(popupCandidatesRoot())).filter(isElVisible);
    } catch (_) { return []; }
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function nearestOpenPopup(button, radiusPx) {
    var vis = popupCandidates();
    if (!vis.length) return null;
    var bc = centerOf(button);
    var best = null;
    for (var i = 0; i < vis.length; i++) {
      var el = vis[i];
      var ec = centerOf(el);
      var dx = bc.x - ec.x, dy = bc.y - ec.y;
      var d = Math.sqrt(dx*dx + dy*dy);
      if (d <= radiusPx && (!best || d < best.d)) best = { el: el, d: d };
    }
    return best ? best.el : null;
  }

  function isMeaningfulPopup(el, cfg) {
    if (!el) return false;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= (cfg.MIN_CHARS || 40)) return true;
    // if semantic elements exist, likely ready
    try {
      if ((cfg.SEMANTIC_SEL && el.querySelector(cfg.SEMANTIC_SEL))) return true;
    } catch (_) {}
    // avoid obvious placeholders
    if (/loading|spinner|skeleton|please wait|正在加载/i.test(text)) return false;
    return text.length > 0;
  }

  function waitForOpenPopup(btn, timeout) {
    var cfg = getCfg();
    var G = (cfg.GLOSSARY_CFG || {});
    var PROX = G.PROXIMITY_PX || 500;
    var tEnd = Date.now() + (timeout || 500);
    return new Promise(function (resolve) {
      (function poll(){
        // direct aria-controls
        try {
          var id = btn && btn.getAttribute && btn.getAttribute('aria-controls');
          if (id) {
            var node = document.getElementById(id);
            if (node && isElVisible(node)) return resolve(node);
          }
        } catch (_) {}

        // nearest visible candidate
        var near = btn ? nearestOpenPopup(btn, PROX) : null;
        if (near && isElVisible(near)) return resolve(near);

        if (Date.now() >= tEnd) return resolve(null);
        setTimeout(poll, 40);
      })();
    });
  }

  function waitForContentReady(container, opts) {
    var cfg = getCfg();
    var C = Object.assign({
      MIN_CHARS: 40,
      STABLE_SAMPLES: 3,
      STABLE_GAP_MS: 80,
      TIMEOUT_MS: 1200,
      SEMANTIC_SEL: 'p, ul, ol, li, pre, code, table, strong, em, h1,h2,h3,h4,h5,h6'
    }, (cfg.CONTENT_READY || {}), (opts || {}));

    return new Promise(function (resolve) {
      var t0 = performance.now ? performance.now() : Date.now();
      var lastHTML = '';
      var stable = 0;
      var timer = null;
      var done = false;
      var mo = null;

      function cleanup() {
        if (done) return;
        done = true;
        try { mo && mo.disconnect(); } catch (_) {}
        if (timer) clearTimeout(timer);
      }

      function step() {
        if (done) return;
        var now = performance.now ? performance.now() : Date.now();
        var html = container.innerHTML;
        var meaningful = isMeaningfulPopup(container, C);

        if (meaningful) {
          if (html === lastHTML) stable += 1;
          else { stable = 1; lastHTML = html; }
          if (stable >= (C.STABLE_SAMPLES || 3)) { cleanup(); return resolve(html); }
        }
        if (now - t0 >= (C.TIMEOUT_MS || 1200)) { cleanup(); return resolve(container.innerHTML); }
        timer = setTimeout(step, C.STABLE_GAP_MS || 80);
      }

      try {
        mo = new MutationObserver(function(){ /* waking loop is enough */ });
        mo.observe(container, { childList: true, subtree: true, characterData: true });
      } catch (_) {}

      step();
    });
  }

  function sanitizeContainerHTML(container) {
    try {
      var clone = container.cloneNode(true);
      // remove interactive controls that aren't informative
      var kill = clone.querySelectorAll('button, [role="button"], [aria-label="Close"], [data-dismiss]');
      for (var i = 0; i < kill.length; i++) kill[i].parentNode && kill[i].parentNode.removeChild(kill[i]);
      return clone.innerHTML || '';
    } catch (_) {
      return container && container.innerHTML || '';
    }
  }

  async function closeAnyOpenGlossary() {
    try {
      // Try Esc first
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    } catch (_) {}
    var wait = ((getCfg().GLOSSARY_CFG || {}).CLOSE_WAIT_MS) || 80;
    await sleep(wait);
  }

  /* ------------- main action ------------- */
  async function clickOpenAndGetHTML(btn) {
    var cfg = getCfg();
    var G = (cfg.GLOSSARY_CFG || {});
    var hoverWait = G.HOVER_CLICK_WAIT_MS || 80;
    var openTimeout = G.OPEN_TIMEOUT_MS || 500;

    var term = (btn && btn.textContent || '').trim();
    try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_){}

    // Ensure no other popover is open (reduces ambiguity for portal frameworks)
    await closeAnyOpenGlossary();

    // small pre-hover helps some Radix/HeadlessUI popovers
    try {
      btn && btn.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      btn && btn.dispatchEvent(new MouseEvent('mousemove',   { bubbles: true }));
    } catch (_) {}

    // 1) Open
    try { btn && btn.click(); } catch (_){}
    await sleep(hoverWait);

    // 2) Find container
    var container = await waitForOpenPopup(btn, openTimeout);
    var method = 'none';
    var html = '';

    if (container) {
      method = (container.getAttribute && (container.getAttribute('role') || container.id)) ? 'id/role' : 'near';
      html = await waitForContentReady(container);
      html = sanitizeContainerHTML(container);
    }

    // 3) If still weak, try exactly one re-open with a slightly longer budget
    var minChars = ((cfg.CONTENT_READY || {}).MIN_CHARS) || 40;
    var weak = !html || html.replace(/\s+/g, '').length < minChars;
    if (weak) {
      log.debug('popup_glossary: retry-open', term || '(term)');
      await closeAnyOpenGlossary();
      await sleep(40);
      try {
        btn && btn.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        btn && btn.dispatchEvent(new MouseEvent('mousemove',   { bubbles: true }));
        btn && btn.click();
      } catch (_){}
      await sleep(hoverWait);

      container = await waitForOpenPopup(btn, openTimeout * 2);
      if (container) {
        method = method + '+retry';
        var ready = await waitForContentReady(container, { TIMEOUT_MS: (((getCfg().CONTENT_READY||{}).TIMEOUT_MS) || 1200) * 1.5 });
        html = sanitizeContainerHTML(container) || ready || '';
      }
    }

    // 4) Close
    try { btn && btn.click(); } catch (_){}
    await sleep(((getCfg().GLOSSARY_CFG || {}).CLOSE_WAIT_MS) || 80);
    await closeAnyOpenGlossary();

    log.debug('popup_glossary: capture', { term: term, method: method, len: (html||'').length });
    return { html: html || '', method: method };
  }

  /* ------------- public API ------------- */
  UI.popup_glossary = {
    __ready__: true,
    clickOpenAndGetHTML: clickOpenAndGetHTML,
    closeAnyOpenGlossary: closeAnyOpenGlossary,
    isElVisible: isElVisible,
    popupCandidates: popupCandidates,
    waitForOpenPopup: waitForOpenPopup,
    waitForContentReady: waitForContentReady
  };

})(window.LCMD);
