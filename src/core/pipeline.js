/* src/core/pipeline.js
 * Orchestrates LCMD: bootstraps UI, captures input/code, fetches LC GraphQL,
 * builds a Markdown report and a Jupyter notebook, and wires toolbar actions.
 *
 * Safe to load multiple times.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var core = NS.defineNS('core');
  if (core.pipeline && core.pipeline.__ready__) return;

  var log  = (NS.core && NS.core.log) || {
    info: function(){}, debug: function(){}, warn: function(){}, error: function(){},
    setLevel: function(){}, mark: function(){}, dumpText: function(){ return ''; }, copyToClipboard: function(){ return Promise.resolve(); }
  };

  var cfgAPI = (NS.core && NS.core.configAPI);
  var CONFIG = (NS.core && NS.core.config) || {};
  function getCfg() { return cfgAPI ? cfgAPI.get() : (NS.core && NS.core.config) || {}; }

  // Modules (guard each since users may iterate file-by-file)
  var DomNS      = NS.dom || {};
  var DomReady   = DomNS.ready || { onReady: function (fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true }); else fn(); }, patchHistory: function(){} };
  var Selectors  = DomNS.selectors || DomNS.sel || (function () {
    function stubVisible(){ return null; }
    function stubGlossary(){ return []; }
    return {
      descriptionRoot: function(){ return document.body; },
      visibleLanguageLabel: stubVisible,
      visibleLangLabel: stubVisible,
      glossaryButtonsInDescription: stubGlossary,
      findGlossaryButtons: stubGlossary
    };
  })();
  var visibleLangLabelFn = Selectors.visibleLanguageLabel || Selectors.visibleLangLabel || function(){ return null; };
  var glossaryButtonsFn = Selectors.glossaryButtonsInDescription || Selectors.findGlossaryButtons || function(){ return []; };

  var ToolbarNS  = NS.ui || {};
  var Toolbar    = ToolbarNS.toolbar || { ensure: function(){}, updateCaptureBadge: function(){} };

  var CaptureNS  = NS.capture || {};
  var NetTap     = CaptureNS.network_tap   || CaptureNS.networkTap   || { install: function(){} };
  var MonacoTop  = CaptureNS.monaco_top    || CaptureNS.monacoTop    || { install: function(){}, request: function(){ return Promise.resolve({ code:'', langId:'', __info:{} }); } };
  var MonacoFr   = CaptureNS.monaco_frames || CaptureNS.monacoFrames || { request: function(){ return Promise.resolve({ code:'', langId:'', __info:{} }); } };
  var StorageScan= CaptureNS.storage_scan  || CaptureNS.storageScan  || { scan: function(){ return { ok:false, code:'', meta:{} }; } };

  var GQLNS      = (NS.lc && (NS.lc.gql || NS.lc.graphql)) || (NS.lc_api && NS.lc_api.graphql) || null;
  var GQL        = GQLNS || {};
  var RESTNS     = (NS.lc && (NS.lc.rest || NS.lc.rest_check)) || (NS.lc_api && NS.lc_api.rest_check) || null;
  var RESTCheck  = RESTNS || {};

  var MDNS       = NS.md || {};
  var HTML2MD    = MDNS.html_to_md   || MDNS.html   || { convert: async function(html){ var div=document.createElement('div'); div.innerHTML=html||''; return { md: (div.textContent||'').trim()+'\n', imgStats: {total:0,embedded:0,failed:0,details:[]}, footnotes:[] }; } };
  var ReportMD   = MDNS.report_build || MDNS.report || {
    buildFullReport: function(parts){ return [parts.headerMd||'',parts.descMd||'',parts.hintsMd||'',parts.testcasesMd||'',parts.subsTableMd||'',parts.codeSectionsMd||''].join('\n'); },
    build: function(parts){ return this.buildFullReport(parts); }
  };

  var NBNS       = NS.nb || {};
  var NBCells    = NBNS.cells || { mdCell: function(md){return {cell_type:'markdown',metadata:{},source:md+'\n'};}, pyCell: function(code){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:code+'\n'};}, harness:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# harness\n'};}, reference:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# reference\n'};}, monacoCell:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# monaco\n'};}, storageCell:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# storage\n'};} };
  var NBBuild    = NBNS.notebook_build || NBNS.notebook || { build: function(){ return { notebook:{cells:[],metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.x'}},nbformat:4,nbformat_minor:5}, filename:'LC-unknown.ipynb' }; } };

  function safeStringify(obj) {
    try { return JSON.stringify(obj); } catch (_) { return String(obj); }
  }

  function toNumberOrNull(v) {
    var num = Number(v);
    return isNaN(num) ? null : num;
  }

  function extractVarNamesFromMeta(q) {
    var names = [];
    var params = q && q.meta && q.meta.params;
    if (Array.isArray(params)) {
      for (var i = 0; i < params.length; i++) {
        var p = params[i] || {};
        var nm = p.name || p.parameter || p.paramName || p.param || p.varName || p.var || '';
        if (nonEmpty(nm) && names.indexOf(nm) === -1) names.push(String(nm));
      }
    }
    return names;
  }

  function extractVarNamesFromDescriptionText(q) {
    try {
      var div = document.createElement('div');
      div.innerHTML = (q && q.content) || '';
      var text = div.textContent || '';
      var lines = text.split(/\r?\n/);
      var names = [];
      for (var i = 0; i < lines.length; i++) {
        var line = (lines[i] || '').trim();
        if (!/^input\s*:/i.test(line)) continue;
        var rhs = line.replace(/^input\s*:/i, '').trim();
        var tokens = rhs.split(/,/g);
        for (var j = 0; j < tokens.length; j++) {
          var tok = tokens[j];
          var m = tok && tok.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
          if (m && names.indexOf(m[1]) === -1) names.push(m[1]);
        }
      }
      return names;
    } catch (_) { return []; }
  }

function buildDefaultVarNamesGuess(blob) {
    var lines = String(blob || '').replace(/\r\n/g, '\n').split('\n');
    if (lines.length >= 2 && /^-?\d+$/.test(lines[0].trim())) {
      var T = parseInt(lines[0], 10);
      var rem = lines.length - 1;
      for (var V = 1; V <= Math.min(6, rem); V++) {
        if (rem % V === 0 && rem / V === T) {
          var guess = [];
          for (var k = 0; k < V; k++) guess.push('var' + (k + 1));
          return guess;
        }
      }
    }
    return ['var1'];
  }

  
function getVariableNames(q, capturedBlob, defaultBlob) {
    var fromMeta = extractVarNamesFromMeta(q);
    if (fromMeta.length) return fromMeta;
    var fromDesc = extractVarNamesFromDescriptionText(q);
    if (fromDesc.length) return fromDesc;
    var refBlob = capturedBlob || defaultBlob || '';
    return buildDefaultVarNamesGuess(refBlob);
  }

  function debugLog(label, data) {
    if (log && typeof log.debug === 'function') {
      try { log.debug(label, safeStringify(data)); return; } catch (_) {}
      try { log.debug(label); } catch (_) {}
    } else if (log && typeof log.info === 'function') {
      try { log.info(label, safeStringify(data)); } catch (_) { log.info(label); }
    }
  }

  function infoLog(label, data) {
    if (log && typeof log.info === 'function') {
      try { log.info(label, safeStringify(data)); } catch (_) { log.info(label); }
    }
  }

  function errorLog(label, err) {
    var msg = err && (err.stack || err.message || err);
    if (log && typeof log.error === 'function') {
      try { log.error(label, msg); } catch (_) { log.error(label); }
    } else if (log && typeof log.warn === 'function') {
      try { log.warn(label, msg); } catch (_) { log.warn(label); }
    }
  }

  function getMethod(obj, names) {
    if (!obj) return null;
    for (var i = 0; i < names.length; i++) {
      var fn = obj[names[i]];
      if (typeof fn === 'function') return fn.bind(obj);
    }
    return null;
  }

  function callMethod(obj, names, args, errLabel) {
    var fn = getMethod(obj, names);
    if (!fn) {
      return Promise.reject(new Error(errLabel || ('Missing method: ' + names.join('/'))));
    }
    try {
      var result = fn.apply(obj, args || []);
      return (result && typeof result.then === 'function') ? result : Promise.resolve(result);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  if (ReportMD && ReportMD.buildFullReport && !ReportMD.build) {
    try { ReportMD.build = ReportMD.buildFullReport.bind(ReportMD); } catch (_) { ReportMD.build = ReportMD.buildFullReport; }
  } else if (ReportMD && ReportMD.build && !ReportMD.buildFullReport) {
    try { ReportMD.buildFullReport = ReportMD.build.bind(ReportMD); } catch (_) { ReportMD.buildFullReport = ReportMD.build; }
  }

  /* ----------------------- Utilities ----------------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length>0; }
  function nowISO(){ try { return new Date().toISOString(); } catch(_) { return String(Date.now()); } }
  function getSlugFromPath(){
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'problems') return parts[1] || null;
    var i = parts.indexOf('problems'); return (i !== -1 && parts[i+1]) ? parts[i+1] : null;
  }
  function toLocalStringFromEpochSec(sec){ try { return sec ? new Date(sec*1000).toLocaleString() : ''; } catch(_){ return ''; } }

  /* ----------------------- Session store for captured inputs ----------------------- */
  var STORE_KEY = 'lc_capture_store_v2';
  function loadStore(){ try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } }
  function saveStore(obj){ try { sessionStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch {} }
  function updateStore(fn){ var o=loadStore(); var r=fn(o)||o; saveStore(r); }
  function setCustomInput(slug, custom){ if (!slug || !nonEmpty(custom)) return; updateStore(function(o){ o[slug]=o[slug]||{}; o[slug].custom={ value:custom, when:Date.now() }; return o; }); }
  function setTypedCode(slug, code, lang){ if (!slug || !nonEmpty(code)) return; updateStore(function(o){ o[slug]=o[slug]||{}; o[slug].typed={ value:code, lang:lang||'', when:Date.now() }; return o; }); }
  function getCustomInput(slug){ var o=loadStore()[slug]||{}; return (o.custom && o.custom.value) || ''; }
  function getTypedCode(slug){ var o=loadStore()[slug]||{}; return o.typed || null; }

  /* ----------------------- Monaco helpers ----------------------- */
  function resolveLabel(monacoId, fallbackLabel){
    if (nonEmpty(fallbackLabel)) return fallbackLabel.trim();
    if (!nonEmpty(monacoId)) return 'Text';
    var s=monacoId.toLowerCase();
    if (s==='python3'||s==='python') return 'Python3';
    if (s==='cpp'||s==='c++') return 'C++';
    if (s==='javascript'||s==='js') return 'JavaScript';
    if (s==='typescript'||s==='ts') return 'TypeScript';
    return monacoId;
  }
  function fenceFromLabel(label){
    if (!nonEmpty(label)) return 'text';
    var s=label.toLowerCase(); if (s==='python3'||s==='python') return 'python';
    if (s==='c++') return 'cpp';
    return s;
  }

  async function grabMonacoCodeAndLang(){
    try { MonacoTop.install && MonacoTop.install(); } catch(_){}
    var t = getCfg().TRACE || {};
    var dumpTop = await (MonacoTop.request ? MonacoTop.request(1200) : Promise.resolve({ code:'', langId:'' }));
    debugLog('pipeline/monaco:topRaw', { hasCode: nonEmpty(dumpTop.code), langId: dumpTop && dumpTop.langId });
    if (t.MONACO) log.debug('monaco/top', JSON.stringify(dumpTop.__info || {}));
    if (nonEmpty(dumpTop.code)) {
      var vis = visibleLangLabelFn();
      var label = resolveLabel(dumpTop.langId || '', vis || '');
      var resultTop = { code: dumpTop.code, label: label, fence: fenceFromLabel(label), meta: { source:'monaco-top' } };
      debugLog('pipeline/monaco:topSelected', { codeLength: resultTop.code.length, label: resultTop.label });
      return resultTop;
    }
    // Fallback to frames
    var dumpFr = await (MonacoFr.request ? MonacoFr.request(1400) : Promise.resolve({ code:'', langId:'' }));
    debugLog('pipeline/monaco:frameRaw', { hasCode: nonEmpty(dumpFr.code), langId: dumpFr && dumpFr.langId });
    if (t.IFRAMES) log.debug('monaco/frame', JSON.stringify(dumpFr.__info || {}));
    if (nonEmpty(dumpFr.code)) {
      var vis2 = visibleLangLabelFn();
      var label2 = resolveLabel(dumpFr.langId || '', vis2 || '');
      var resultFrame = { code: dumpFr.code, label: label2, fence: fenceFromLabel(label2), meta: { source:'monaco-frame' } };
      debugLog('pipeline/monaco:frameSelected', { codeLength: resultFrame.code.length, label: resultFrame.label });
      return resultFrame;
    }
    debugLog('pipeline/monaco:none', { reason: 'no editors detected' });
    return { code:'', label:'Text', fence:'text', meta: { source:'monaco-none' } };
  }

  /* ----------------------- Glossary quick capture (lightweight) ----------------------- */
  async function captureGlossaryPairs(limit){
    var rootDesc = Selectors.descriptionRoot ? Selectors.descriptionRoot() : null;
    var btns = glossaryButtonsFn(rootDesc);
    debugLog('pipeline/glossary:buttons', { count: (btns && btns.length) || 0, limit: limit });
    if (!btns || !btns.length) return [];
    var max = Math.min(limit || 20, btns.length);
    var pairs = [];
    for (var i=0;i<max;i++){
      var btn = btns[i];
      try{
        var term = (btn.textContent || '').trim();
        var got = await (NS.ui && NS.ui.popup_glossary && NS.ui.popup_glossary.clickOpenAndGetHTML ? NS.ui.popup_glossary.clickOpenAndGetHTML(btn) : Promise.resolve({ html:'' }));
        var html = got.html || '';
        if (!nonEmpty(term) || !nonEmpty(html)) {
          debugLog('pipeline/glossary:skip', { term: term, htmlLength: html && html.length });
          continue;
        }
        var mdObj = await HTML2MD.convert(html, { inlineImages: getCfg().md && getCfg().md.INLINE_IMAGES });
        var glossaryNS = NS.md && (NS.md.glossary_markdown || NS.md.glossary);
        var label = term.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/^-+|-+$/g,'');
        if (glossaryNS && typeof glossaryNS.toLabel === 'function') {
          try { label = glossaryNS.toLabel(term); } catch (_) {}
          if (glossaryNS && typeof glossaryNS.uniqueLabel === 'function') {
            try { label = glossaryNS.uniqueLabel(label, {}); } catch (_) {}
          }
        }
        if (!label) label = 'term-' + (i+1);
        pairs.push({ term: term, label: label, md: (mdObj.md || '').trim() });
        debugLog('pipeline/glossary:pair', { term: term, label: label, mdLength: (mdObj.md || '').length });
      }catch(e){
        errorLog('pipeline/glossary:error', e);
      }
    }
    debugLog('pipeline/glossary:complete', { captured: pairs.length });
    return pairs;
  }

  /* ----------------------- Markdown assembly helpers ----------------------- */
  function buildProblemHeader(q, solved){
    var id = q && q.questionId ? String(q.questionId).trim() : '';
    var title = (q && (q.title || q.titleSlug)) || 'Unknown Title';
    var shownTitle = id ? (id + '. ' + title) : title;
    var diff = (q && q.difficulty) || 'Unknown';
    var s = (q && q.statsObj) || {};
    var totalAcc = s.totalAccepted ?? s.totalAcceptedRaw ?? '';
    var totalSubs = s.totalSubmission ?? s.totalSubmissionRaw ?? '';
    var acRate = (typeof s.acRate === 'string' && s.acRate) ? s.acRate : '';
    var topics=(Array.isArray(q && q.topicTags) ? q.topicTags : []).map(function(t){ return t.name; }).join(', ');
    var solvedStr = solved ? '✅ Solved' : '⬜ Not solved (in recent history)';
    var md = '# ' + shownTitle + '\n\n' +
             '**Difficulty:** ' + diff + '  \n' +
             '**Status:** ' + solvedStr + '\n\n' +
             '**Stats:** Accepted: ' + totalAcc + ' &nbsp;&nbsp; ' +
             'Submissions: ' + totalSubs + ' &nbsp;&nbsp; ' +
             'Acceptance: ' + acRate + '\n\n';
    if (topics) md += '**Topics:** ' + topics + '\n\n';
    return md;
  }

  function buildSubmissionsTable(slug, rows){
    var includeLang = !!(getCfg().md && getCfg().md.INCLUDE_LANG_IN_MD);
    var langHdr = includeLang ? ' | Lang' : '';
    var langSep = includeLang ? ' |:-----' : '';
    var header = '## Submissions — `' + (slug || '') + '`\n\n' +
      '| # | ID | Status' + langHdr + ' | Time | Runtime (ms) | Runtime Beats % | Memory (MB) | Memory Beats % |\n' +
      '|:-:|---:|:------' + langSep + '|:-----|------------:|----------------:|-----------:|---------------:|\n';
    var body = rows.map(function(r, idx){
      var timeStr = toLocalStringFromEpochSec(r.timestamp);
      var lang = includeLang ? (' | ' + (r.lang || '')) : '';
      var rb = (r.runtimeBeats != null) ? (Number(r.runtimeBeats).toFixed(2)) : '';
      var mb = (r.memoryBeats  != null) ? (Number(r.memoryBeats).toFixed(2))  : '';
      var rt = (r.runtimeMs != null) ? String(r.runtimeMs) : '';
      var mm = (r.memoryMB  != null) ? String(r.memoryMB)  : '';
      return '| ' + (idx+1) + ' | ' + r.id + ' | ' + (r.statusDisplay||'') + lang + ' | ' + timeStr + ' | ' + rt + ' | ' + rb + ' | ' + mm + ' | ' + mb + ' |';
    }).join('\n');
    return header + body + '\n\n';
  }

  function sanitizeCodeForMarkdown(code) {
    if (!nonEmpty(code)) return '';
    return String(code).replace(/(^|\n)```+/g, function(m, p1){ return p1 + '# ```'; });
  }

  /* ----------------------- Clipboard & download ----------------------- */
  async function copyText(text){
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch(_){}
    try { if (typeof root.GM_setClipboard === 'function') { root.GM_setClipboard(text, { type:'text', mimetype:'text/plain' }); return true; } } catch(_){}
    try { var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; } catch(_){ return false; }
  }

  async function downloadFile(name, mime, dataStr){
    var DATA_URL = 'data:' + mime + ',' + encodeURIComponent(dataStr);
    if (typeof root.GM_download === 'function'){
      try {
        await new Promise(function(resolve,reject){
          root.GM_download({ url: DATA_URL, name: name, saveAs: true, onload: resolve, onerror: function(e){ reject(new Error((e && (e.error||e.details)) || 'GM_download error')); }, ontimeout: function(){ reject(new Error('GM_download timeout')); } });
        });
        return true;
      } catch(e){ /* fallthrough */ }
    }
    try {
      var a = document.createElement('a');
      a.href = DATA_URL; a.download = name; a.rel='noopener';
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    } catch(e){}
    try {
      var blob = new Blob([dataStr], { type: mime });
      var url = URL.createObjectURL(blob);
      var a2 = document.createElement('a'); a2.href=url; a2.download=name; a2.rel='noopener';
      document.body.appendChild(a2); a2.click(); a2.remove();
      setTimeout(function(){ try{ URL.revokeObjectURL(url);}catch(_){} }, 10000);
      return true;
    } catch(e){ log.error('download failed', e); return false; }
  }

  /* ----------------------- Pipeline ----------------------- */
  async function runPipeline(opts) {
    opts = opts || {};
    var produceReport = !!opts.produceReport;
    var wantNotebook = !!opts.wantNotebook;

    var slug = getSlugFromPath();
    if (!slug) throw new Error('No problem slug in URL.');

    debugLog('pipeline/options', { slug: slug, produceReport: produceReport, wantNotebook: wantNotebook });
    log.info('pipeline/start', nowISO(), 'slug=', slug);

    var cfg = getCfg();
    var limits = cfg.limits || {};
    var subsOpts = {
      limit: limits.MAX_SUBMISSIONS || 60,
      pageSize: limits.PAGE_SIZE || 20
    };

    var qPromise = callMethod(GQL, ['fetchQuestion', 'queryQuestion'], [slug], 'GraphQL fetchQuestion not available')
      .then(function (data) {
        data = data || {};
        debugLog('pipeline/question:ok', { slug: slug, title: data.title || data.titleSlug, hasContent: !!(data && data.content) });
        return data;
      })
      .catch(function (err) {
        errorLog('pipeline/question:error', err);
        throw err;
      });

    var subsPromise = callMethod(GQL, ['fetchSubmissions', 'fetchSubmissionsForSlug', 'querySubmissionList'], [slug, subsOpts], 'GraphQL fetchSubmissions not available')
      .then(function (list) {
        var arr = Array.isArray(list) ? list : ((list && list.submissions) || []);
        debugLog('pipeline/submissions:ok', { count: arr.length, limit: subsOpts.limit, pageSize: subsOpts.pageSize });
        return arr;
      })
      .catch(function (err) {
        errorLog('pipeline/submissions:error', err);
        return [];
      });

    var hintsPromise = callMethod(GQL, ['fetchHints', 'queryHints'], [slug], 'GraphQL fetchHints not available')
      .then(function (list) {
        var arr = Array.isArray(list) ? list : [];
        debugLog('pipeline/hints:ok', { count: arr.length });
        return arr;
      })
      .catch(function (err) {
        errorLog('pipeline/hints:error', err);
        return [];
      });

    var pairs = [];
    try {
      pairs = await captureGlossaryPairs((cfg.GLOSSARY_CFG && cfg.GLOSSARY_CFG.MAX_TERMS) || 20);
    } catch (e) {
      errorLog('pipeline/glossary:failure', e);
      pairs = [];
    }

    var res = await Promise.all([qPromise, subsPromise, hintsPromise]);
    var q = res[0] || {};
    var subs = Array.isArray(res[1]) ? res[1] : [];
    var hints = Array.isArray(res[2]) ? res[2] : [];
    debugLog('pipeline/data:summary', { submissions: subs.length, hints: hints.length, titleSlug: q && q.titleSlug });

    var rows = [];
    var detailsById = {};
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i] || {};
      var idNum = Number(s.id);
      var row = {
        id: idNum,
        statusDisplay: s.statusDisplay || '',
        timestamp: s.timestamp || null,
        lang: s.lang || '',
        runtimeMs: toNumberOrNull(s.runtimeMs),
        runtimeBeats: toNumberOrNull(s.runtimeBeats),
        memoryMB: toNumberOrNull(s.memoryMB),
        memoryBeats: toNumberOrNull(s.memoryBeats),
        runtimeStr: s.runtimeStr || '',
        memoryStr: s.memoryStr || '',
        note: s.note || ''
      };
      rows.push(row);

      try {
        var det = await callMethod(GQL, ['fetchSubmissionDetails', 'querySubmissionDetails'], [idNum], 'GraphQL fetchSubmissionDetails not available');
        det = det || {};
        detailsById[idNum] = { code: det.code || '', lang: det.lang || s.lang || '' };
        var detRuntimeMs = toNumberOrNull(det.runtimeMs); if (detRuntimeMs != null) row.runtimeMs = detRuntimeMs;
        var detRuntimeBeats = toNumberOrNull(det.runtimeBeats); if (detRuntimeBeats != null) row.runtimeBeats = detRuntimeBeats;
        var detMemoryMB = toNumberOrNull(det.memoryMB); if (detMemoryMB != null) row.memoryMB = detMemoryMB;
        var detMemoryBeats = toNumberOrNull(det.memoryBeats); if (detMemoryBeats != null) row.memoryBeats = detMemoryBeats;
        if (det.runtimeStr != null) row.runtimeStr = det.runtimeStr;
        if (det.memoryStr != null) row.memoryStr = det.memoryStr;
        if (det.note) row.note = det.note;
        debugLog('pipeline/submission:detail', { id: idNum, codeLength: (det.code || '').length, lang: (detailsById[idNum] && detailsById[idNum].lang) || '', runtimeMs: row.runtimeMs, memoryMB: row.memoryMB });
      } catch (e) {
        errorLog('pipeline/submission:detailError', e);
      }

      var needsRest = /accepted/i.test(row.statusDisplay) &&
        (row.runtimeBeats == null || row.memoryBeats == null || row.runtimeMs == null || row.memoryMB == null);
      if (needsRest) {
        try {
          var rest = null;
          var pollFn = getMethod(RESTCheck, ['pollCheck']);
          if (pollFn) {
            rest = await pollFn(idNum, { tries: 7 });
          } else {
            var fetchRawFn = getMethod(RESTCheck, ['fetchCheckRaw']);
            var parseFn = getMethod(RESTCheck, ['parseCheck']);
            if (fetchRawFn && parseFn) {
              var raw = await fetchRawFn(idNum, { timeoutMs: (cfg.api && cfg.api.timeoutMs) || 12000 });
              if (raw && raw.json) {
                rest = parseFn(raw.json);
              }
            }
          }
          if (rest) {
            var restRuntimeMs = toNumberOrNull(rest.runtimeMs); if (restRuntimeMs != null) row.runtimeMs = restRuntimeMs;
            var restRuntimeBeats = toNumberOrNull(rest.runtimeBeats); if (restRuntimeBeats != null) row.runtimeBeats = restRuntimeBeats;
            var restMemoryMB = toNumberOrNull(rest.memoryMB); if (restMemoryMB != null) row.memoryMB = restMemoryMB;
            var restMemoryBeats = toNumberOrNull(rest.memoryBeats); if (restMemoryBeats != null) row.memoryBeats = restMemoryBeats;
            if (rest.runtimeStr) row.runtimeStr = rest.runtimeStr;
            if (rest.memoryStr) row.memoryStr = rest.memoryStr;
            debugLog('pipeline/submission:rest', { id: s.id, runtimeMs: row.runtimeMs, memoryMB: row.memoryMB });
          }
        } catch (e) {
          errorLog('pipeline/submission:restError', e);
        }
      }
    }

    var monacoEditor;
    try {
      monacoEditor = await grabMonacoCodeAndLang();
      debugLog('pipeline/monaco:selected', { source: monacoEditor && monacoEditor.meta && monacoEditor.meta.source, codeLength: monacoEditor && monacoEditor.code ? monacoEditor.code.length : 0, label: monacoEditor && monacoEditor.label });
    } catch (e) {
      errorLog('pipeline/monaco:error', e);
      monacoEditor = { code: '', label: 'Text', fence: 'text', meta: { source: 'error' } };
    }

    var storageScan;
    try {
      storageScan = (StorageScan && typeof StorageScan.scan === 'function') ? StorageScan.scan(slug, q) : { ok: false, meta: { error: 'storageScan missing' } };
    } catch (e) {
      errorLog('pipeline/storage:error', e);
      storageScan = { ok: false, meta: { error: e && (e.message || e) } };
    }
    debugLog('pipeline/storage', { ok: storageScan && storageScan.ok, codeLength: storageScan && storageScan.code ? storageScan.code.length : 0, key: storageScan && storageScan.meta && storageScan.meta.key });

    if (!HTML2MD || typeof HTML2MD.convert !== 'function') {
      throw new Error('HTML2MD.convert not available');
    }
    var descConv = await HTML2MD.convert(q && q.content || '', { inlineImages: cfg.md && cfg.md.INLINE_IMAGES, pairs: pairs });
    debugLog('pipeline/description', { mdLength: descConv && descConv.md ? descConv.md.length : 0, images: descConv && descConv.imgStats });

    var exA = q && q.exampleTestcases || '';
    var exB = q && q.sampleTestCase || '';
    var defaultBlob = [exA, exB].filter(nonEmpty).join('\n').trim();
    var capturedBlob = getCustomInput(slug);
    debugLog('pipeline/testcases', { defaultLength: defaultBlob.length, customLength: capturedBlob.length });

    var varNames = getVariableNames(q, capturedBlob, defaultBlob);
    debugLog('pipeline/varNames', { count: varNames.length, names: varNames });

    var solved = rows.some(function(r){ return /accepted/i.test(r.statusDisplay); });

    var reportBuilder = getMethod(ReportMD, ['buildFullReport', 'build']);
    if (!reportBuilder) {
      throw new Error('Report builder unavailable');
    }
    var reportPayload = {
      question: q,
      solved: solved,
      descMd: descConv && descConv.md ? descConv.md : '',
      imgStats: descConv && descConv.imgStats ? descConv.imgStats : null,
      hints: hints,
      varNames: varNames,
      defaultBlob: defaultBlob,
      customBlob: capturedBlob,
      monacoEditor: monacoEditor,
      storageScan: storageScan,
      rows: rows,
      detailsById: detailsById,
      slug: (q && q.titleSlug) || slug
    };

    var includeLang = cfg.md && ('INCLUDE_LANG_IN_MD' in cfg.md) ? !!cfg.md.INCLUDE_LANG_IN_MD : !!(cfg.md && cfg.md.includeLangInMd);
    var reportMd;
    try {
      reportMd = reportBuilder(reportPayload, { includeLang: includeLang });
      debugLog('pipeline/report:generated', { length: reportMd && reportMd.length });
    } catch (e) {
      errorLog('pipeline/report:buildError', e);
      throw e;
    }

    var nbOut = null;
    if (wantNotebook) {
      var nbBuilder = getMethod(NBBuild, ['build']);
      if (nbBuilder) {
        try {
          nbOut = nbBuilder({
            question: q,
            solved: solved,
            descMd: descConv && descConv.md ? descConv.md : '',
            hints: hints,
            varNames: varNames,
            defaultBlob: defaultBlob,
            customBlob: capturedBlob,
            subs: rows,
            detailsById: detailsById,
            monacoEditor: monacoEditor,
            storageScan: storageScan
          });
          debugLog('pipeline/notebook:built', { filename: nbOut && nbOut.filename, cells: nbOut && nbOut.notebook && Array.isArray(nbOut.notebook.cells) ? nbOut.notebook.cells.length : null });
        } catch (e) {
          errorLog('pipeline/notebook:buildError', e);
        }
      } else {
        errorLog('pipeline/notebook:builderMissing', new Error('NBBuild.build not available'));
      }
    }

    log.info('pipeline/finish', nowISO(), 'slug=', slug, 'rows=', rows.length);
    debugLog('pipeline/output', { mdLength: reportMd && reportMd.length, hasNotebook: !!(nbOut && nbOut.notebook) });
    return { md: reportMd, notebook: nbOut && nbOut.notebook, filename: nbOut && nbOut.filename };
  }

  /* ----------------------- UI handlers ----------------------- */
  var BUSY = false;

  async function onCopyReport(){
    if (BUSY) return;
    BUSY = true; try{
      var out = await runPipeline({ produceReport:true, wantNotebook:false });
      await copyText(out.md);
      log.info('report: copied to clipboard');
    } catch (e){
      log.error('report error', e && (e.message || e));
      alert('Error building report — see console.');
    } finally { BUSY = false; }
  }

  async function onCopyLog(){
    try { await log.copyToClipboard(); } catch(_){}
  }

  async function onSaveNotebook(){
    if (BUSY) return;
    BUSY = true; try{
      var out = await runPipeline({ produceReport:false, wantNotebook:true });
      var fname = (out && out.filename) || ('LC-' + (getSlugFromPath() || 'unknown') + '.ipynb');
      var nbJSON = JSON.stringify(out.notebook || {cells:[],metadata:{},nbformat:4,nbformat_minor:5}, null, 2);
      var ok = await downloadFile(fname, 'application/x-ipynb+json;charset=utf-8', nbJSON);
      if (!ok) alert('Failed to save notebook (check console).');
    } catch (e){
      log.error('notebook error', e && (e.message || e));
      alert('Error building notebook — see console.');
    } finally { BUSY = false; }
  }

  /* ----------------------- Bootstrap ----------------------- */
  function installNetworkTap(){
    try{
      NetTap.install(function(data){
        try{
          var slug = getSlugFromPath();
          if (!slug) return;
          if (nonEmpty(data.customInput)) setCustomInput(slug, data.customInput);
          if (nonEmpty(data.typedCode))   setTypedCode(slug, data.typedCode, data.lang || '');
          try { Toolbar.updateCaptureBadge && Toolbar.updateCaptureBadge(); } catch(_){}
          log.debug('networkTap', JSON.stringify({ slug: slug, gotInput: !!data.customInput, gotCode: !!data.typedCode }));
        }catch(e){ log.debug('networkTap/cb error', e && (e.message || e)); }
      });
    }catch(e){ log.debug('networkTap/install error', e && (e.message || e)); }
  }

  function updateCaptureBadgeOnce(){
    try { Toolbar.updateCaptureBadge && Toolbar.updateCaptureBadge(); } catch(_){}
  }

  function bootstrap(){
    // Guard for SPA re-injections (also see bootstrap userscript)
    var PIPELINE_FLAG = '__LC_MD_PIPELINE_READY__';
    if (root[PIPELINE_FLAG]) return;
    try {
      root[PIPELINE_FLAG] = true;
      if (!root.__LC_MD_INSTALLED__) root.__LC_MD_INSTALLED__ = true;
    } catch(_) {
      try { window[PIPELINE_FLAG] = true; } catch(__) {}
      try { if (!window.__LC_MD_INSTALLED__) window.__LC_MD_INSTALLED__ = true; } catch(__) {}
    }

    // Optional: read ?lcmd= query overrides
    try { cfgAPI && cfgAPI.loadFromQuery && cfgAPI.loadFromQuery(); } catch(_){}

    // Attach handlers
    DomReady.patchHistory && DomReady.patchHistory();
    DomReady.onReady(function(){
      Toolbar.ensure({ onCopyReport: onCopyReport, onCopyLog: onCopyLog, onSaveNotebook: onSaveNotebook });
      updateCaptureBadgeOnce();
    });

    // Prepare Monaco taps and network taps
    try { MonacoTop.install && MonacoTop.install(); } catch(_){}
    installNetworkTap();

    // Gentle hint in console
    log.info('LCMD bootstrap ready.');
  }

  core.pipeline = {
    __ready__: true,
    bootstrap: bootstrap,
    run: runPipeline,            // programmatic: await LCMD.core.pipeline.run({produceReport:true})
    copyReport: onCopyReport,
    saveNotebook: onSaveNotebook,
    copyLog: onCopyLog
  };

})(window.LCMD);


