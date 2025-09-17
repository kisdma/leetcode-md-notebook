/* src/md/html_to_md.js
 * HTML → Markdown converter with:
 *   - Inline image embedding (GM_xmlhttpRequest or fetch fallback)
 *   - <sup>/<sub> preservation (including inside <code>)
 *   - Tables, lists, headings, links, code blocks
 *   - Glossary anchor injection (skip fenced code)
 *
 * Public API (LCMD.md.html_to_md):
 *   convert(html, opts?) -> Promise<{ md, imgStats, footnotes }>
 *
 * Options (opts):
 *   - inlineImages?: boolean                (default: config.md.inlineImages)
 *   - imageTimeoutMs?: number               (default: config.md.imageTimeoutMs)
 *   - pairs?: Array<{term,label,md}>       (glossary entries; inserted + linked)
 *   - baseUrl?: string                      (for resolving relative image/links)
 *   - wrapWithHeader?: boolean              (default: true)
 *   - header?: string                       (default: '## Description')
 *
 * Notes:
 *   - Idempotent: safe to @require multiple times.
 *   - Does not mutate DOM; uses a detached container.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var MD = NS.defineNS('md');
  var existing = MD.html_to_md || MD.html;
  if (existing && existing.__ready__) return;

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;
  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  /* ---------------------------- utils ---------------------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }
  function makeAbsoluteUrl(u, base) {
    try { return new URL(u, base || location.href).href; } catch (_) { return u; }
  }
  function gmXhrAvailable(){
    try {
      return (typeof GM_xmlhttpRequest === 'function') ||
             (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function');
    } catch (_){ return false; }
  }
  function doGmXhr(opts){
    return new Promise(function(resolve, reject){
      try {
        var fn = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest :
                 (GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
        if (!fn) { reject(new Error('GM_xmlhttpRequest not available')); return; }
        fn(Object.assign({}, opts, {
          onload: resolve,
          onerror: function (e){ reject(new Error((e && (e.error || e.details)) || 'GM_xhr error')); },
          ontimeout: function(){ reject(new Error('GM_xhr timeout')); }
        }));
      } catch (e) { reject(e); }
    });
  }
  function arrayBufferToBase64(ab){
    var bytes = new Uint8Array(ab || []);
    var chunk = 0x8000, binary = '';
    for (var i=0;i<bytes.length;i+=chunk){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
    }
    return btoa(binary);
  }

  async function fetchImageAsDataURL(url, timeoutMs){
    // Prefer GM_xhr for CORS leniency
    if (gmXhrAvailable()){
      try{
        var res = await doGmXhr({ method: 'GET', url: url, timeout: timeoutMs, responseType: 'arraybuffer' });
        var headers = String(res.responseHeaders || '');
        var ctMatch = headers.match(/^\s*content-type:\s*([^\r\n;]+)/im);
        var mime = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
        var ab = res.response; var size = ab ? ab.byteLength : 0;
        var b64 = size > 0 ? arrayBufferToBase64(ab) : '';
        if (b64) return { ok:true, dataUrl: 'data:'+mime+';base64,'+b64, mime: mime, size: size };
      } catch (e) {
        // fall-through to fetch
      }
    }
    try{
      var r = await fetch(url, { credentials:'include' });
      if (!r.ok) throw new Error('HTTP '+r.status);
      var blob = await r.blob();
      var fr = new FileReader();
      var dataUrl = await new Promise(function(res, rej){ fr.onload = function(){ res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); });
      return { ok:true, dataUrl: dataUrl, mime: blob.type || 'application/octet-stream', size: blob.size || 0 };
    }catch(e){
      return { ok:false, error: (e && (e.message || e)) || 'fetch failed', dataUrl:'', mime:'', size:0 };
    }
  }

  // Preserve exponents/subscripts inside text (including <code>)
  function textWithSupSub(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    var tag = node.tagName.toLowerCase();
    if (tag === 'sup') {
      var innerS = ''; for (var i=0;i<node.childNodes.length;i++) innerS += textWithSupSub(node.childNodes[i]);
      innerS = innerS.replace(/\s+/g, '');
      return '^' + innerS;
    }
    if (tag === 'sub') {
      var innerB = ''; for (var j=0;j<node.childNodes.length;j++) innerB += textWithSupSub(node.childNodes[j]);
      innerB = innerB.replace(/\s+/g, '');
      return '_' + innerB;
    }
    var out = '';
    for (var k=0;k<node.childNodes.length;k++) out += textWithSupSub(node.childNodes[k]);
    return out;
  }

  function shouldPad(prev, next) {
    if (!prev || !next) return false;
    if (/^[,.;:!?)]/.test(next)) return false;
    if (/[([{\u201C\u2018]$/.test(prev)) return false;
    var wordEnd = /[A-Za-z0-9`\]\*_]$/;
    var wordStart = /^[A-Za-z0-9`\[\*_]/;
    return wordEnd.test(prev) && wordStart.test(next);
  }
  function smartJoin(parts) {
    var out = '';
    for (var i=0;i<parts.length;i++){
      var s = String(parts[i] || '');
      if (!s) continue;
      var needSpace = out && !/\s$/.test(out) && !/^\s/.test(s) && shouldPad(out, s);
      out += (needSpace ? ' ' : '') + s;
    }
    return out;
  }

  function onlySpecialKids(el){
    var specials = { PRE:1, TABLE:1, BLOCKQUOTE:1, UL:1, OL:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, IMG:1 };
    var kids = []; for (var i=0;i<el.childNodes.length;i++){ var n=el.childNodes[i]; if (n.nodeType===Node.ELEMENT_NODE) kids.push(n); }
    if (!kids.length) return false;
    for (var k=0;k<kids.length;k++){ if (!specials[kids[k].tagName]) return false; }
    return true;
  }

  function fenceFromClass(cls){
    if (!cls) return '';
    var m = String(cls).match(/language-([a-z0-9+_-]+)/i);
    return (m && m[1]) || '';
  }

  function tableToMarkdown(tbl){
    var rows = tbl.querySelectorAll('tr');
    if (!rows.length) return '';
    var first = rows[0];
    var ths = first.querySelectorAll('th');
    var heads = [];
    var i, c;
    if (ths.length){
      for (i=0;i<ths.length;i++) heads.push((ths[i].textContent || '').trim());
    } else {
      var tds = first.children || [];
      for (i=0;i<tds.length;i++) heads.push('Col '+(i+1));
    }
    var md=[];
    md.push('');
    md.push('|'+heads.map(function(h){ return ' '+h+' '; }).join('|')+'|');
    md.push('|'+heads.map(function(){ return '---'; }).join('|')+'|');

    var start = ths.length ? 1 : 0;
    for (i=start;i<rows.length;i++){
      var cells = rows[i].children || [];
      var vals = [];
      for (c=0;c<cells.length;c++){
        var t = (cells[c].textContent || '').trim().replace(/\|/g, '\\|');
        vals.push(' '+t+' ');
      }
      md.push('|'+vals.join('|')+'|');
    }
    md.push('');
    return md.join('\n');
  }

  /* --------------------- glossary helpers --------------------- */
  function injectGlossaryAnchors(descMd, pairs) {
    if (!nonEmpty(descMd) || !pairs || !pairs.length) return descMd;

    // Split outside code blocks to avoid re-linking inside fences.
    var chunks = descMd.split(/(\n```[\s\S]*?\n```)/g);
    var used = Object.create(null);

    function inject(text){
      var out = text;
      for (var i=0;i<pairs.length;i++){
        var p = pairs[i];
        if (!p || !p.term || !p.label || !p.md) continue;
        if (used[p.label]) continue;
        var safe = p.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var re = new RegExp('\\b(' + safe + ')\\b');
        if (re.test(out)) {
          out = out.replace(re, '['+p.term+'](#glossary-'+p.label+')');
          used[p.label] = 1;
        }
      }
      return out;
    }

    for (var i=0;i<chunks.length;i++){
      if (i % 2 === 0) chunks[i] = inject(chunks[i]);
    }
    return chunks.join('');
  }

  function buildGlossarySection(pairs) {
    if (!pairs || !pairs.length) return '';
    var md = '## Glossary\n\n';
    for (var i=0;i<pairs.length;i++){
      var p = pairs[i];
      if (!p || !p.label) continue;
      var term = (p.term || '').trim();
      var body = (p.md || '').trim();
      md += '<a id="glossary-'+p.label+'"></a>\n';
      md += (term ? ('**'+term+'**  \n') : '');
      md += (body ? body.replace(/\n/g, '  \n') : '') + '\n\n';
    }
    return md;
  }

  /* --------------------- conversion core --------------------- */
  async function convert(html, opts){
    var cfg = getCfg();
    var O = Object.assign({
      inlineImages: !!(cfg.md && cfg.md.inlineImages),
      imageTimeoutMs: (cfg.md && cfg.md.imageTimeoutMs) || 20000,
      pairs: null,
      baseUrl: location.href,
      wrapWithHeader: true,
      header: '## Description'
    }, opts || {});

    if (!nonEmpty(html)) {
      var emptyMd = O.wrapWithHeader ? (O.header + '\n\n') : '';
      return { md: emptyMd, imgStats: { total:0, embedded:0, failed:0, details:[] }, footnotes: [] };
    }

    var stats = { total:0, embedded:0, failed:0, details:[] };

    var container = document.createElement('div');
    container.innerHTML = html;

    // Prepare images (optionally inline)
    if (O.inlineImages) {
      var imgs = container.querySelectorAll('img');
      for (var i=0;i<imgs.length;i++){
        var img = imgs[i];
        try {
          stats.total++;
          var srcAttr = img.getAttribute('src') || img.getAttribute('data-src') || '';
          var abs = makeAbsoluteUrl(srcAttr, O.baseUrl);
          if (!abs) { stats.failed++; continue; }
          var r = await fetchImageAsDataURL(abs, O.imageTimeoutMs);
          if (r.ok && r.dataUrl) {
            img.dataset.mdSrc = r.dataUrl;
            img.dataset.mdAlt = img.getAttribute('alt') || '';
            img.setAttribute('data-embed-ok','1');
            stats.embedded++;
            stats.details.push({ url: abs, embedded: true, size: r.size, mime: r.mime });
          } else {
            img.dataset.mdSrc = abs;
            var altOrig = img.getAttribute('alt') || '';
            img.dataset.mdAlt = (altOrig ? (altOrig + ' ') : '') + '⚠️ not embedded (remote)';
            img.setAttribute('data-embed-ok','0');
            stats.failed++;
            stats.details.push({ url: abs, embedded: false, reason: (r && r.error) || 'unknown' });
          }
        } catch (e) {
          var srcRaw = img.getAttribute('src') || img.getAttribute('data-src') || '';
          var abs2 = makeAbsoluteUrl(srcRaw, O.baseUrl);
          img.dataset.mdSrc = abs2;
          var altO = img.getAttribute('alt') || '';
          img.dataset.mdAlt = (altO ? (altO + ' ') : '') + '⚠️ not embedded (error)';
          img.setAttribute('data-embed-ok','0');
          stats.failed++;
          stats.details.push({ url: abs2, embedded: false, reason: (e && (e.message || e)) || 'exception' });
        }
      }
    }

    async function nodeToMarkdown(node, depth){
      if (!node) return '';
      var t = node.nodeType;
      if (t === Node.TEXT_NODE) return (node.nodeValue || '').replace(/\s+/g,' ');
      if (t !== Node.ELEMENT_NODE) return '';

      var tag = node.tagName.toLowerCase();
      var getChildren = async function(){
        var parts = [];
        for (var i=0;i<node.childNodes.length;i++) parts.push(await nodeToMarkdown(node.childNodes[i], depth));
        return smartJoin(parts);
      };

      switch(tag){
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          var level = +tag[1];
          var inner = (await getChildren()).trim();
          return '\n' + Array(level+1).join('#') + ' ' + inner + '\n\n';
        }
        case 'p': case 'section': case 'article': case 'div': {
          if (onlySpecialKids(node)) return await getChildren();
          var innerP = (await getChildren()).trim();
          return innerP ? (innerP + '\n\n') : '';
        }
        case 'strong': case 'b': {
          var innB = (await getChildren()).trim();
          return innB ? ('**' + innB + '**') : '';
        }
        case 'em': case 'i': {
          var innI = (await getChildren()).trim();
          return innI ? ('*' + innI + '*') : '';
        }
        case 'code': {
          if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
            var raw = textWithSupSub(node);
            return '\n```\n' + raw.replace(/\n$/, '') + '\n```\n\n';
          }
          var innerC = textWithSupSub(node);
          return '`' + innerC.replace(/`/g, '\\`') + '`';
        }
        case 'pre': {
          var codeEl = node.querySelector('code');
          var rawPre = (codeEl ? codeEl.textContent : node.textContent) || '';
          var lang = codeEl ? fenceFromClass(codeEl.className || '') : '';
          return '\n```' + (lang || '') + '\n' + rawPre.replace(/\n$/, '') + '\n```\n\n';
        }
        case 'ul': {
          var outU = '\n';
          for (var i1=0;i1<node.children.length;i1++){
            var li1 = node.children[i1]; if (!li1 || li1.tagName.toLowerCase() !== 'li') continue;
            var content1 = (await nodeToMarkdown(li1, depth+1)).trim();
            var pad1 = new Array(depth+1).join('  ');
            outU += pad1 + '- ' + content1 + '\n';
          }
          return outU + '\n';
        }
        case 'ol': {
          var outO = '\n', idx = 1;
          for (var i2=0;i2<node.children.length;i2++){
            var li2 = node.children[i2]; if (!li2 || li2.tagName.toLowerCase() !== 'li') continue;
            var content2 = (await nodeToMarkdown(li2, depth+1)).trim();
            var pad2 = new Array(depth+1).join('  ');
            outO += pad2 + idx + '. ' + content2 + '\n';
            idx++;
          }
          return outO + '\n';
        }
        case 'li': {
          var parts = '';
          for (var i3=0;i3<node.childNodes.length;i3++) parts += await nodeToMarkdown(node.childNodes[i3], depth);
          return parts.replace(/\n{3,}/g, '\n\n').trim();
        }
        case 'a': {
          var href = node.getAttribute('href') || '';
          var abs = makeAbsoluteUrl(href, O.baseUrl);
          var text = (await getChildren()).trim() || abs;
          return '['+text+']('+abs+')';
        }
        case 'img': {
          var src = node.dataset.mdSrc || node.getAttribute('src') || '';
          var alt = node.dataset.mdAlt || node.getAttribute('alt') || '';
          var absI = makeAbsoluteUrl(src, O.baseUrl);
          return '!['+alt+']('+absI+')';
        }
        case 'blockquote': {
          var innerQ = (await getChildren()).trim();
          return innerQ.split('\n').map(function(l){ return '> ' + l; }).join('\n') + '\n\n';
        }
        case 'hr': return '\n---\n\n';
        case 'table': return tableToMarkdown(node) + '\n';
        case 'br': return '\n';
        default: return await getChildren();
      }
    }

    async function nodeToMdRoot() {
      var md = (await nodeToMarkdown(container, 0)).trim().replace(/\n{3,}/g,'\n\n');
      return md;
    }

    var mdRaw = await nodeToMdRoot();

    // Glossary (if provided)
    var descWithAnchors = injectGlossaryAnchors(mdRaw, O.pairs);
    var glossarySection = buildGlossarySection(O.pairs);

    var out = '';
    if (O.wrapWithHeader && nonEmpty(O.header)) out += O.header + '\n\n';
    out += descWithAnchors + '\n\n' + glossarySection;

    return {
      md: out,
      imgStats: stats,
      footnotes: [] // reserved for future use
    };
  }

  /* --------------------- export --------------------- */
  var API = {
    __ready__: true,
    convert: convert,
    // Optional utility hooks for advanced use/testing
    _utils: {
      fetchImageAsDataURL: fetchImageAsDataURL,
      injectGlossaryAnchors: injectGlossaryAnchors,
      buildGlossarySection: buildGlossarySection
    }
  };

  MD.html_to_md = API;
  MD.html = API; // legacy alias

})(window.LCMD);
