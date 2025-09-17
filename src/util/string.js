/* src/util/string.js
 * String helpers: emptiness, clipping, slugging, escaping, and MD-safe utilities.
 *
 * Public API (LCMD.util.string):
 *   nonEmpty(s) -> boolean
 *   clip(s, n=120) -> string
 *   slugify(s) -> string
 *   escapeRegExp(s) -> string
 *   sanitizeCodeForMarkdown(code) -> string
 *   commentOutsideFences(text, {commentPrefix='# '}?) -> string
 *   normalizeWhitespace(s) -> string
 *   lines(s) -> string[]
 *   indent(s, n=2) -> string
 *   stripMarkdown(s) -> string
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  var existing = UTIL.string || UTIL.str;
  if (existing && existing.__ready__) return;

  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }

  function clip(s, n){
    n = (typeof n === 'number' && n > 1) ? n : 120;
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function slugify(s){
    s = String(s == null ? '' : s).toLowerCase();
    return s.replace(/[\s_]+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/^-+|-+$/g,'');
  }

  function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Prevent accidental ``` from breaking MD blocks
  function sanitizeCodeForMarkdown(code){
    var t = String(code == null ? '' : code);
    return t.replace(/(^|\n)```+/g, function(_, p1){ return p1 + '# ```'; });
  }

  // Comment all content outside fenced code blocks; keep code intact.
  function commentOutsideFences(input, opts){
    opts = opts || {};
    var prefix = typeof opts.commentPrefix === 'string' ? opts.commentPrefix : '# ';
    var text = String(input == null ? '' : input).replace(/\r\n/g, '\n');
    var fenceRe = /(^|\n)\s*(```|~~~)/g;
    var parts = [];
    var last = 0, m, open = false;

    while ((m = fenceRe.exec(text))){
      var idx = m.index + (m[1] ? m[1].length : 0);
      var fence = m[2];
      var chunk = text.slice(last, idx);
      if (!open) parts.push(chunk.split('\n').map(function(ln){ return ln.trim().length ? (prefix + ln) : prefix.trim(); }).join('\n'));
      else parts.push(chunk);
      // include the fence line, but comment it when outside
      var fenceLineEnd = text.indexOf('\n', idx);
      fenceLineEnd = fenceLineEnd === -1 ? text.length : fenceLineEnd+1;
      var fenceLine = text.slice(idx, fenceLineEnd);
      parts.push(open ? fenceLine : (prefix + fenceLine).replace(/\s+$/,''));
      last = fenceLineEnd;
      open = !open;
    }
    var tail = text.slice(last);
    if (!open) parts.push(tail.split('\n').map(function(ln){ return ln.trim().length ? (prefix + ln) : prefix.trim(); }).join('\n'));
    else parts.push(tail);
    return parts.join('');
  }

  function normalizeWhitespace(s){ return String(s == null ? '' : s).replace(/\s+/g,' ').trim(); }
  function lines(s){ return String(s == null ? '' : s).replace(/\r\n/g,'\n').split('\n'); }

  function indent(s, n){
    n = (typeof n === 'number' && n >= 0) ? n : 2;
    var pad = new Array(n+1).join(' ');
    return String(s == null ? '' : s).split('\n').map(function(ln){ return pad + ln; }).join('\n');
  }

  // Best-effort Markdown stripper for plain-text logging
  function stripMarkdown(s){
    s = String(s == null ? '' : s);
    return s
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')            // images
      .replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1')        // links -> URL
      .replace(/(^|\s)[*_]{1,3}([^*_]+)[*_]{1,3}(\s|$)/g, '$1$2$3') // bold/italic
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')          // inline code
      .replace(/^>+\s?/gm, '')                        // blockquotes
      .replace(/^#{1,6}\s*/gm, '')                    // headings
      .replace(/^\s*[-*+]\s+/gm, '• ')                // bullets
      .replace(/^\s*\d+\.\s+/gm, '• ')                // ordered lists
      .replace(/^\s*---+\s*$/gm, '')                  // hr
      .trim();
  }

  var API = {
    __ready__: true,
    nonEmpty: nonEmpty,
    clip: clip,
    slugify: slugify,
    escapeRegExp: escapeRegExp,
    sanitizeCodeForMarkdown: sanitizeCodeForMarkdown,
    commentOutsideFences: commentOutsideFences,
    normalizeWhitespace: normalizeWhitespace,
    lines: lines,
    indent: indent,
    stripMarkdown: stripMarkdown
  };

  UTIL.string = API;
  UTIL.str = API; // legacy alias for older modules
})(window.LCMD);
