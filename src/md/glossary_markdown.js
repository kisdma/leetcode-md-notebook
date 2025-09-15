/* src/md/glossary_markdown.js
 * Helpers for converting captured glossary popover HTML into Markdown,
 * producing stable anchor labels, and injecting term links into prose.
 *
 * Public API (LCMD.md.glossary):
 *   toLabel(term)                  -> string            // slugified base label (no uniqueness)
 *   uniqueLabel(base, used)        -> string            // ensure uniqueness against a Set/map
 *   sanitize(html)                 -> string            // strip interactive UI chrome before convert
 *   fromPopupHTML(html)            -> string            // convert sanitized popover HTML to Markdown
 *   buildSection(pairs)            -> string            // "## Glossary" section from [{term,label,md}]
 *   injectAnchors(descMd, pairs)   -> string            // link first mentions: Term → [Term](#glossary-label)
 *
 * Notes:
 * - This module is intentionally light-weight and independent of html_to_md.js.
 * - It focuses on the narrow markup usually found in LeetCode glossary popovers.
 * - All functions are side-effect free and idempotent.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var MD = NS.defineNS('md');
  if (MD.glossary && MD.glossary.__ready__) return;

  /* ------------------------- utilities ------------------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }

  function toLabel(term) {
    var t = (term || '').toString().trim();
    t = t.replace(/[\r\n]+/g, ' ').replace(/[\[\]]/g, '');
    if (!t) t = 'term';
    return t.toLowerCase()
            .replace(/\s+/g, '-')          // spaces → dashes
            .replace(/[^a-z0-9-]/g, '')    // keep [a-z0-9-]
            .replace(/^-+|-+$/g, '');      // trim dashes
  }

  function uniqueLabel(base, used) {
    var label = nonEmpty(base) ? base : 'term';
    var i = 2;

    // Normalize used => a Set-like (has, add)
    var has = function(x){ return used && (used.has ? used.has(x) : !!used[x]); };
    var add = function(x){ if (!used) return; if (used.add) used.add(x); else used[x] = true; };

    while (has(label)) label = base + '-' + (i++);
    add(label);
    return label;
  }

  function sanitize(html) {
    if (!nonEmpty(html)) return '';
    var div = document.createElement('div');
    div.innerHTML = html;

    // Remove obvious chrome/controls
    var killSel = [
      'button', '[role="button"]', '[aria-label="Close"]', '[data-dismiss]',
      '.ant-modal-close', '.ant-popover-buttons', '.ant-tooltip-close',
      '[data-state="closing"]'
    ].join(',');
    try {
      var nodes = div.querySelectorAll(killSel);
      for (var i=0;i<nodes.length;i++){ nodes[i].parentNode && nodes[i].parentNode.removeChild(nodes[i]); }
    } catch(_){}

    return div.innerHTML || '';
  }

  /* -------- minimal HTML → Markdown for glossary popovers -------- */
  function textWithSupSub(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    var tag = node.tagName.toLowerCase();
    if (tag === 'sup') {
      var s = ''; for (var i=0;i<node.childNodes.length;i++) s += textWithSupSub(node.childNodes[i]);
      return '^' + s.replace(/\s+/g,'');
    }
    if (tag === 'sub') {
      var b = ''; for (var j=0;j<node.childNodes.length;j++) b += textWithSupSub(node.childNodes[j]);
      return '_' + b.replace(/\s+/g,'');
    }
    var out = '';
    for (var k=0;k<node.childNodes.length;k++) out += textWithSupSub(node.childNodes[k]);
    return out;
  }

  function smartJoin(parts) {
    var out = '';
    function shouldPad(prev, next) {
      if (!prev || !next) return false;
      if (/^[,.;:!?)]/.test(next)) return false;
      if (/[([{\u201C\u2018]$/.test(prev)) return false;
      var wordEnd = /[A-Za-z0-9`\]\*_]$/;
      var wordStart = /^[A-Za-z0-9`\[\*_]/;
      return wordEnd.test(prev) && wordStart.test(next);
    }
    for (var i=0;i<parts.length;i++){
      var s = String(parts[i] || '');
      if (!s) continue;
      var needSpace = out && !/\s$/.test(out) && !/^\s/.test(s) && shouldPad(out, s);
      out += (needSpace ? ' ' : '') + s;
    }
    return out;
  }

  function listToMd(listEl, depth, ordered) {
    var out = '\n';
    var idx = 1;
    for (var i=0;i<listEl.children.length;i++){
      var li = listEl.children[i];
      if (!li || li.tagName.toLowerCase() !== 'li') continue;
      var content = nodeToMd(li, depth+1).trim();
      var pad = new Array(depth+1).join('  ');
      out += ordered ? (pad + (idx++) + '. ' + content + '\n') : (pad + '- ' + content + '\n');
    }
    return out + '\n';
  }

  function tableToMd(tbl){
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

  function fenceFromClass(cls){
    if (!cls) return '';
    var m = String(cls).match(/language-([a-z0-9+_-]+)/i);
    return (m && m[1]) || '';
  }

  function nodeToMd(node, depth){
    if (!node) return '';
    var t = node.nodeType;
    if (t === Node.TEXT_NODE) return (node.nodeValue || '').replace(/\s+/g, ' ');
    if (t !== Node.ELEMENT_NODE) return '';

    var tag = node.tagName.toLowerCase();

    function children() {
      var parts = [];
      for (var i=0;i<node.childNodes.length;i++) parts.push(nodeToMd(node.childNodes[i], depth));
      return smartJoin(parts);
    }

    switch(tag){
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        // For compact popovers, keep headings as bold lines (not ATX headers)
        var innerH = children().trim();
        return innerH ? ('\n**' + innerH + '**\n') : '';
      }
      case 'p': case 'section': case 'article': case 'div': {
        var innerP = children().trim();
        return innerP ? (innerP + '\n\n') : '';
      }
      case 'strong': case 'b': {
        var innB = children().trim();
        return innB ? ('**' + innB + '**') : '';
      }
      case 'em': case 'i': {
        var innI = children().trim();
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
      case 'ul': return listToMd(node, depth, false);
      case 'ol': return listToMd(node, depth, true);
      case 'li': {
        var parts = '';
        for (var i3=0;i3<node.childNodes.length;i3++) parts += nodeToMd(node.childNodes[i3], depth);
        return parts.replace(/\n{3,}/g, '\n\n').trim();
      }
      case 'a': {
        var href = node.getAttribute('href') || '';
        var text = children().trim() || href;
        return '['+text+']('+href+')';
      }
      case 'img': {
        // Avoid embedding here; keep simple links for popovers
        var src = node.getAttribute('src') || node.getAttribute('data-src') || '';
        var alt = node.getAttribute('alt') || '';
        if (!src) return alt ? ('*' + alt + '*') : '';
        return '!['+alt+']('+src+')';
      }
      case 'blockquote': {
        var innerQ = children().trim();
        return innerQ.split('\n').map(function(l){ return '> ' + l; }).join('\n') + '\n\n';
      }
      case 'hr': return '\n---\n\n';
      case 'table': return tableToMd(node) + '\n';
      case 'br': return '\n';
      default: return children();
    }
  }

  function fromPopupHTML(html) {
    if (!nonEmpty(html)) return '';
    var div = document.createElement('div');
    div.innerHTML = sanitize(html);
    var md = nodeToMd(div, 0).trim().replace(/\n{3,}/g, '\n\n');
    return md;
  }

  /* ----------------- section building & linking ----------------- */
  function buildSection(pairs) {
    if (!pairs || !pairs.length) return '';
    var md = '## Glossary\n\n';
    for (var i=0;i<pairs.length;i++){
      var p = pairs[i] || {};
      if (!nonEmpty(p.label)) continue;
      var term = (p.term || '').trim();
      var body = (p.md || '').trim();
      md += '<a id="glossary-' + p.label + '"></a>\n';
      if (term) md += '**' + term + '**  \n';
      if (body) md += body.replace(/\n/g, '  \n');
      md += '\n\n';
    }
    return md;
  }

  // Inject [Term](#glossary-label) for first matches outside fenced code blocks.
  function injectAnchors(descMd, pairs) {
    if (!nonEmpty(descMd) || !pairs || !pairs.length) return descMd;

    var chunks = descMd.split(/(\n```[\s\S]*?\n```)/g);
    var used = Object.create(null);

    function inject(text) {
      var out = text;
      for (var i=0;i<pairs.length;i++){
        var p = pairs[i];
        if (!p || !p.term || !p.label) continue;
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

    for (var k=0;k<chunks.length;k++){
      if (k % 2 === 0) chunks[k] = inject(chunks[k]);
    }
    return chunks.join('');
  }

  /* --------------------------- export --------------------------- */
  MD.glossary = {
    __ready__: true,
    toLabel: toLabel,
    uniqueLabel: uniqueLabel,
    sanitize: sanitize,
    fromPopupHTML: fromPopupHTML,
    buildSection: buildSection,
    injectAnchors: injectAnchors
  };

})(window.LCMD);
