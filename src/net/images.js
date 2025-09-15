/* src/net/images.js
 * Image utilities for fetching and inlining <img> sources as Data URLs.
 *
 * Responsibilities:
 *  - Walk a DOM container, find <img> elements, and attempt to embed them
 *    as data URLs using LCMD.net.gm.fetchAsDataURL (GM_xhr first, fetch fallback)
 *  - Provide a one-shot helper to process a raw HTML string and return
 *    the transformed HTML plus detailed stats
 *  - Be conservative and resilient: never throw on individual failures
 *
 * Public API (LCMD.net.images):
 *   isDataUrl(u) -> boolean
 *   absoluteUrl(u, base?) -> string
 *
 *   embedOne(imgEl, opts?) -> Promise<Detail>
 *   embedInDom(root, opts?) -> Promise<{stats, details}>
 *   embedInHtml(html, opts?) -> Promise<{html, stats, details}>
 *
 * Types:
 *   Stats:
 *     {
 *       total: number,
 *       embedded: number,
 *       failed: number
 *     }
 *
 *   Detail:
 *     {
 *       el?: HTMLImageElement,           // only for embedOne / embedInDom
 *       url: string,                     // absolute URL we attempted
 *       embedded: boolean,               // true if inlined as data URL
 *       size?: number,                   // bytes (when known)
 *       mime?: string,                   // MIME type (when known)
 *       reason?: string                  // reason on failure
 *     }
 *
 * Options:
 *   {
 *     timeoutMs?: number = 20000,        // per-image timeout
 *     srcAttrs?: string[] = ['src','data-src'],
 *     annotateAlt?: boolean = true,      // append warning on failure
 *     markAttr?: string = 'data-embed-ok', // '1' on success, '0' on failure
 *     altDataKey?: string = 'mdAlt',     // element.dataset[altDataKey]
 *     srcDataKey?: string = 'mdSrc'      // element.dataset[srcDataKey]
 *   }
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var NET = NS.defineNS('net');
  if (NET.images && NET.images.__ready__) return;

  var log   = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var GMN   = (NET && NET.gm) || null;

  function isDataUrl(u){
    try { return typeof u === 'string' && /^data:[^;]+;base64,/i.test(u); } catch(_) { return false; }
  }
  function absoluteUrl(u, base){
    if (GMN && typeof GMN.absoluteUrl === 'function') return GMN.absoluteUrl(u, base);
    try { return new URL(u, base || location && location.href || '').href; } catch(_) { return String(u || ''); }
  }

  function _getSrc(img, srcAttrs){
    for (var i=0;i<srcAttrs.length;i++){
      var val = img.getAttribute(srcAttrs[i]);
      if (val && String(val).trim()) return val;
    }
    return '';
  }

  function _opts(opts){
    opts = opts || {};
    return {
      timeoutMs: (typeof opts.timeoutMs === 'number' && opts.timeoutMs >= 0) ? opts.timeoutMs : 20000,
      srcAttrs: Array.isArray(opts.srcAttrs) && opts.srcAttrs.length ? opts.srcAttrs : ['src', 'data-src', 'data-original', 'data-lazy'],
      annotateAlt: ('annotateAlt' in opts) ? !!opts.annotateAlt : true,
      markAttr: (typeof opts.markAttr === 'string' && opts.markAttr) ? opts.markAttr : 'data-embed-ok',
      altDataKey: (typeof opts.altDataKey === 'string' && opts.altDataKey) ? opts.altDataKey : 'mdAlt',
      srcDataKey: (typeof opts.srcDataKey === 'string' && opts.srcDataKey) ? opts.srcDataKey : 'mdSrc'
    };
  }

  /**
   * Attempt to inline a single <img>.
   * Writes:
   *   img.dataset[srcDataKey] = dataURL or absolute URL on failure
   *   img.dataset[altDataKey] = alt (plus warning if failed and annotateAlt)
   *   img.setAttribute(markAttr, '1' | '0')
   */
  async function embedOne(img, opts){
    var O = _opts(opts);
    try{
      if (!img || !img.getAttribute) {
        return { el: img, url: '', embedded: false, reason: 'not-an-image' };
      }
      var raw = _getSrc(img, O.srcAttrs);
      var abs = absoluteUrl(raw);
      var altOrig = img.getAttribute('alt') || '';

      // If already a data URL, just record & mark as embedded
      if (isDataUrl(raw)) {
        try { img.dataset[O.srcDataKey] = raw; img.dataset[O.altDataKey] = altOrig; img.setAttribute(O.markAttr, '1'); } catch(_) {}
        return { el: img, url: raw, embedded: true, size: NaN, mime: '', reason: undefined };
      }

      if (!GMN || typeof GMN.fetchAsDataURL !== 'function') {
        // Fallback: cannot embed; record absolute URL
        try {
          img.dataset[O.srcDataKey] = abs;
          img.dataset[O.altDataKey] = O.annotateAlt && altOrig ? (altOrig + ' ⚠️ not embedded (no GM)') : (altOrig || '⚠️ not embedded (no GM)');
          img.setAttribute(O.markAttr, '0');
        } catch(_) {}
        return { el: img, url: abs, embedded: false, reason: 'gm_xhr_unavailable' };
      }

      var r = await GMN.fetchAsDataURL(abs, O.timeoutMs);
      if (r && r.ok && r.dataUrl) {
        try { img.dataset[O.srcDataKey] = r.dataUrl; img.dataset[O.altDataKey] = altOrig; img.setAttribute(O.markAttr, '1'); } catch(_) {}
        return { el: img, url: abs, embedded: true, size: r.size || 0, mime: r.mime || '' };
      }

      // Failure path: record absolute URL + annotate
      try {
        img.dataset[O.srcDataKey] = abs;
        var why = (r && r.error) ? r.error : 'fetch_failed';
        var add = O.annotateAlt ? (altOrig ? (altOrig + ' ') : '') + '⚠️ not embedded (' + why + ')' : (altOrig || '');
        img.dataset[O.altDataKey] = add;
        img.setAttribute(O.markAttr, '0');
      } catch(_) {}
      return { el: img, url: abs, embedded: false, reason: (r && r.error) || 'fetch_failed' };

    } catch(e){
      try{
        var raw2 = _getSrc(img || {}, O.srcAttrs);
        var abs2 = absoluteUrl(raw2);
        var alt2 = (img && img.getAttribute) ? (img.getAttribute('alt') || '') : '';
        img && img.setAttribute && img.setAttribute(O.markAttr, '0');
        if (img && img.dataset){
          img.dataset[O.srcDataKey] = abs2;
          img.dataset[O.altDataKey] = O.annotateAlt ? (alt2 ? (alt2 + ' ') : '') + '⚠️ not embedded (exception)' : alt2;
        }
        return { el: img, url: abs2, embedded: false, reason: e && e.message || 'exception' };
      } catch(_ignore){
        return { el: img, url: '', embedded: false, reason: e && e.message || 'exception' };
      }
    }
  }

  /**
   * Process all <img> under a root element.
   */
  async function embedInDom(root, opts){
    var O = _opts(opts);
    var imgs;
    try { imgs = Array.prototype.slice.call((root || document).querySelectorAll('img')); }
    catch(_) { imgs = []; }

    var stats = { total: 0, embedded: 0, failed: 0 };
    var details = [];

    for (var i=0;i<imgs.length;i++){
      var img = imgs[i];
      stats.total++;
      try{
        var d = await embedOne(img, O);
        details.push(d);
        if (d.embedded) stats.embedded++; else stats.failed++;
      }catch(e){
        details.push({ el: img, url: _getSrc(img, O.srcAttrs), embedded: false, reason: e && e.message || 'exception' });
        stats.failed++;
      }
    }
    return { stats: stats, details: details };
  }

  /**
   * Given an HTML string, embed images and return the transformed HTML + stats.
   * Implementation: create a detached DOM, run embedInDom(), serialize innerHTML.
   */
  async function embedInHtml(html, opts){
    try{
      var div = document.createElement('div');
      div.innerHTML = String(html || '');
      var out = await embedInDom(div, opts);
      return { html: div.innerHTML, stats: out.stats, details: out.details };
    } catch(e){
      return { html: String(html || ''), stats: { total:0, embedded:0, failed:0 }, details: [], error: e && e.message || 'exception' };
    }
  }

  /* --------------------------------- export --------------------------------- */
  NET.images = {
    __ready__: true,
    isDataUrl: isDataUrl,
    absoluteUrl: absoluteUrl,
    embedOne: embedOne,
    embedInDom: embedInDom,
    embedInHtml: embedInHtml
  };

})(window.LCMD);
