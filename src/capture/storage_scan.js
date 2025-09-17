/* src/capture/storage_scan.js
 * Heuristic scan of window.localStorage for plausible LeetCode editor code.
 *
 * Public API:
 *   LCMD.capture.storage_scan.scan(slug, question?, opts?) -> { ok, code, meta }
 *     - slug: problem titleSlug (preferred for key matching)
 *     - question: minimal LC question object { meta, codeSnippets, titleSlug, ... } (optional)
 *     - opts: { maxStrings?, maxDepth? }
 *
 * Notes:
 * - Safe to @require multiple times (idempotent).
 * - Does not mutate localStorage. Read-only.
 * - Tries hard to avoid false positives; returns {ok:false} if nothing convincing is found.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var CAP = NS.defineNS('capture');
  var existing = CAP.storage_scan || CAP.storageScan;
  if (existing && existing.__ready__) return;

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;
  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  /* ---------------- utils ---------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }
  function safeJSONParse(t){ try { return JSON.parse(t); } catch(_){ return null; } }
  function uniquePush(arr, v){ if (arr.indexOf(v) === -1) arr.push(v); }

  /* ---------------- heuristics ---------------- */

  // Very lightweight language hints
  var CODE_HINTS = [
    // Python
    /\bclass\s+Solution\b/, /\bdef\s+[A-Za-z_]\w*\s*\(/, /\bfrom\s+\w+\s+import\b/, /\bimport\s+\w+/,
    // C++
    /#\s*include\s*<[^>]+>/, /\bstd::\w+/, /\bvector\s*<\w+>/, /\busing\s+namespace\b/,
    // Java
    /\bpublic\s+class\s+\w+/, /\bpublic\s+static\s+void\s+main/, /\bSystem\.out\.println/,
    // C#
    /\busing\s+System\b/, /\bConsole\.WriteLine/,
    // JS/TS
    /\bfunction\s+[A-Za-z_]\w*\s*\(/, /\bconst\s+[A-Za-z_]\w*\s*=\s*\(/, /\)\s*=>\s*{/, /\bexport\s+(default|const|function)/,
    // Go
    /\bpackage\s+\w+/, /\bfunc\s+\w+\s*\(/,
    // Rust
    /\bfn\s+[A-Za-z_]\w*\s*\(/, /\blet\s+mut\s+\w+/,
    // Kotlin/Swift-ish
    /\bfun\s+\w+\s*\(/, /\bclass\s+\w+\s*:\s*\w+/,
  ];

  function looksLikeCode(s){
    if (!nonEmpty(s)) return false;
    // Minimum shape: a few lines and some code tokens
    var lines = s.replace(/\r\n/g, '\n').split('\n');
    if (lines.length < 3) return false;
    var tokenHit = 0;
    for (var i=0;i<CODE_HINTS.length;i++){ if (CODE_HINTS[i].test(s)) { tokenHit++; if (tokenHit >= 2) break; } }
    if (tokenHit >= 2) return true;
    // Generic structure hints
    var semi = (s.match(/;/g) || []).length;
    var braces = (s.match(/[{}]/g) || []).length;
    if (semi + braces >= 6 && lines.length >= 5) return true;
    // Pythonic fallback
    if (/\bclass\s+\w+\b/.test(s) && /\bdef\s+\w+\s*\(/.test(s)) return true;
    return false;
  }

  function sniffFunctionNameFromSnippets(q){
    try {
      var arr = (q && q.codeSnippets) || [];
      for (var i=0;i<arr.length;i++){
        var src = String(arr[i].code || '');
        // Python first
        var mPy = src.match(/\bdef\s+([A-Za-z_]\w*)\s*\(/);
        if (mPy) return mPy[1];
        // Generic (best effort)
        var mFn = src.match(/\b([A-Za-z_]\w*)\s*\(/);
        if (mFn && !/^(if|for|while|switch|return|class|function)$/.test(mFn[1])) return mFn[1];
      }
    } catch(_){}
    return '';
  }

  function isCodeLikelyForProblem(code, q){
    if (!nonEmpty(code)) return false;
    // Presence of class Solution is a strong LeetCode indicator
    var hasSolutionClass = /\bclass\s+Solution\b/.test(code);
    var fn = (q && q.meta && (q.meta.name || q.meta.functionName || q.meta.fun || q.meta.funcName)) || '';
    if (!fn) fn = sniffFunctionNameFromSnippets(q);
    var hasFn = nonEmpty(fn) ? new RegExp("\\b" + fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\b").test(code) : false;
    if (hasSolutionClass && hasFn) return true;
    if (hasSolutionClass && !fn)  return true; // generic LC solutions
    // Looser bound: any function that seems solution-ish + references of typical LeetCode I/O
    if (/\bListNode\b|\bTreeNode\b|\bnodes?\b|\bgrid\b|\bnums?\b/.test(code) && /\bclass\b|\bdef\b|\bfunction\b/.test(code)) return true;
    return false;
  }

  // Depth-limited DFS to collect string leaves that look like code (or maybe code)
  function extractCodeStringsFromJsonVal(v, capDepth, maxStrings){
    var out = [];
    var count = 0;

    function walk(o, d){
      if (count >= maxStrings) return;
      if (d > capDepth) return;
      if (typeof o === 'string') {
        if (looksLikeCode(o)) { out.push(o); count++; }
        return;
      }
      if (!o || typeof o !== 'object') return;
      // Guard circulars
      var keys;
      try { keys = Object.keys(o); } catch(_) { keys = []; }
      for (var i=0;i<keys.length;i++){
        if (count >= maxStrings) break;
        var k = keys[i];
        try { walk(o[k], d+1); } catch(_){}
      }
    }
    try { walk(v, 0); } catch(_){}
    return out;
  }

  function inferLangLabel(t){
    if (!nonEmpty(t)) return 'Text';
    // Order matters (distinctive first)
    if (/^\s*#\s*include\b/.test(t) || /\bstd::\w+/.test(t)) return 'C++';
    if (/\bpublic\s+class\s+\w+/.test(t) || /\bSystem\.out\.println/.test(t)) return 'Java';
    if (/\busing\s+System\b/.test(t) || /\bConsole\.WriteLine/.test(t)) return 'C#';
    if (/\bpackage\s+\w+/.test(t) || /\bfunc\s+\w+\s*\(/.test(t)) return 'Go';
    if (/\bfn\s+\w+\s*\(/.test(t) || /\blet\s+mut\b/.test(t)) return 'Rust';
    if (/\bfun\s+\w+\s*\(/.test(t) || /\bclass\s+\w+\s*:\s*\w+/.test(t)) return 'Kotlin';
    if (/<\?php\b/.test(t)) return 'PHP';
    if (/\bdef\s+\w+\s*\(/.test(t) || /\bclass\s+Solution\b/.test(t)) return 'Python3';
    if (/\bexport\s+/.test(t) || /\b:\s*\w+\b/.test(t)) return 'TypeScript';
    if (/\bfunction\b/.test(t) || /=>\s*{/.test(t)) return 'JavaScript';
    return 'Text';
  }

  function scoreCandidate(code, key, slug, q){
    var score = 0; var reasons = [];
    var len = (code || '').length;

    if (looksLikeCode(code)) { score += 3; reasons.push('looksLikeCode'); }
    var matchSlug = nonEmpty(slug) && typeof key === 'string' && key.toLowerCase().indexOf(slug.toLowerCase()) !== -1;
    if (matchSlug) { score += 2; reasons.push('keyHasSlug'); }

    var forProblem = isCodeLikelyForProblem(code, q);
    if (forProblem) { score += 2; reasons.push('problemHeuristic'); }

    // Longer buffers are more plausible
    if (len >= 400)      { score += 2; reasons.push('len>=400'); }
    else if (len >= 200) { score += 1; reasons.push('len>=200'); }

    // Language-specific tiny boosts
    var lang = inferLangLabel(code);
    if (lang === 'Python3' || lang === 'C++' || lang === 'Java') { score += 1; reasons.push('commonLC_lang'); }

    return { score: score, reasons: reasons, matchSlug: !!matchSlug, lang: lang, length: len, forProblem: !!forProblem };
  }

  /* ---------------- scan core ---------------- */
  function collectLocalStorageKeys(ls){
    var keys = [];
    try {
      var n = ls.length >>> 0;
      for (var i=0;i<n;i++){ try { uniquePush(keys, ls.key(i)); } catch(_){ /* continue */ } }
      // Fallback: enumerable keys (some environments)
      for (var k in ls){ if (Object.prototype.hasOwnProperty.call(ls, k)) uniquePush(keys, k); }
    } catch(_){}
    return keys.filter(nonEmpty);
  }

  function readLS(ls, key){
    try { return String(ls.getItem(key)); } catch(_){ try { return String(ls[key]); } catch(__){ return ''; } }
  }

  function scan(slug, q, opts){
    var ls;
    try { ls = window.localStorage; } catch(_){}
    if (!ls) return { ok:false, code:'', meta:{ error:'localStorage unavailable' } };

    var cfg = getCfg() || {};
    var S = Object.assign({ maxStrings: 3, maxDepth: 3 }, (cfg.capture && cfg.capture.storage) || {}, opts || {});

    var keys = collectLocalStorageKeys(ls);
    if (!keys.length) return { ok:false, code:'', meta:{ error:'no localStorage keys' } };

    var lowerSlug = nonEmpty(slug) ? slug.toLowerCase() : '';
    var bucketSlug = [];   // candidates from keys that include slug
    var bucketOther = [];  // all others

    for (var i=0;i<keys.length;i++){
      var key = keys[i];
      var raw = readLS(ls, key);
      if (!nonEmpty(raw)) continue;

      var texts = [];
      var parsed = safeJSONParse(raw);
      if (parsed && typeof parsed === 'object') {
        texts = extractCodeStringsFromJsonVal(parsed, S.maxDepth, S.maxStrings);
      } else if (looksLikeCode(raw)) {
        texts = [raw];
      }

      if (!texts.length) continue;

      for (var t=0;t<texts.length;t++){
        var text = texts[t];
        var sc = scoreCandidate(text, key, lowerSlug, q);
        var cand = {
          key: key,
          code: text,
          score: sc.score,
          reasons: sc.reasons,
          matchSlug: sc.matchSlug,
          lang: sc.lang,
          length: sc.length,
          seemsForThis: sc.forProblem
        };
        if (sc.matchSlug) bucketSlug.push(cand); else bucketOther.push(cand);
      }
    }

    function byScoreLen(a,b){ if (b.score !== a.score) return b.score - a.score; return (b.length||0) - (a.length||0); }

    var chosen = bucketSlug.sort(byScoreLen)[0] || null;
    if (!chosen) {
      var fallback = bucketOther.sort(byScoreLen)[0] || null;
      return { ok:false, code:'', meta:{ error:'no localStorage code tied to this slug', fallbackKey: fallback && fallback.key, fallbackScore: fallback && fallback.score, fallbackLen: fallback && fallback.length } };
    }

    if (chosen.matchSlug && !chosen.seemsForThis) {
      return { ok:false, code:'', meta:{ error:'slug key found but code looks unrelated', key: chosen.key, matchSlug: true, reasons: chosen.reasons, score: chosen.score, length: chosen.length } };
    }

    // Guard against unrelated short/weak finds
    if (chosen.score < 3 || (chosen.length || 0) < 80) {
      return { ok:false, code:'', meta:{ error:'weak candidate', key: chosen.key, score: chosen.score, len: chosen.length, matchSlug: !!chosen.matchSlug, seemsForThis: !!chosen.seemsForThis } };
    }

    return {
      ok: true,
      code: chosen.code,
      meta: {
        key: chosen.key,
        matchSlug: chosen.matchSlug,
        langGuess: chosen.lang,
        score: chosen.score,
        reasons: chosen.reasons,
        length: chosen.length,
        seemsForThis: !!chosen.seemsForThis
      }
    };
  }

  /* ---------------- public API ---------------- */
  var API = {
    __ready__: true,
    scan: scan
  };

  CAP.storage_scan = API;
  CAP.storageScan = API; // legacy alias

})(window.LCMD);
