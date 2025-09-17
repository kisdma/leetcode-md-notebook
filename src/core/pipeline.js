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
  var DomReady   = NS.dom && NS.dom.ready || { onReady: function (fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true }); else fn(); }, patchHistory: function(){} };
  var Selectors  = NS.dom && NS.dom.selectors || { descriptionRoot: function(){ return document.body; }, visibleLangLabel: function(){ return null; }, findGlossaryButtons: function(){ return []; } };
  var Toolbar    = NS.ui  && NS.ui.toolbar   || { ensure: function(){}, updateCaptureBadge: function(){} };

  var NetTap     = NS.capture && NS.capture.networkTap   || { install: function(){} };
  var MonacoTop  = NS.capture && NS.capture.monacoTop     || { install: function(){}, request: function(){ return Promise.resolve({ code:'', langId:'', __info:{} }); } };
  var MonacoFr   = NS.capture && NS.capture.monacoFrames  || { request: function(){ return Promise.resolve({ code:'', langId:'', __info:{} }); } };
  var StorageScan= NS.capture && NS.capture.storageScan   || { scan: function(){ return { ok:false, code:'', meta:{} }; } };

  var GQL        = NS.lc_api && NS.lc_api.gql           || { fetchQuestion:async function(){return {};}, fetchHints:async function(){return [];}, fetchSubmissions:async function(){return []}, fetchSubmissionDetails:async function(){return { code:'', lang:''}; } };
  var RESTCheck  = NS.lc_api && NS.lc_api.restCheck     || { fetch: async function(){return {}; } };

  var HTML2MD    = NS.md && NS.md.html_to_md            || { convert: async function(html){ var div=document.createElement('div'); div.innerHTML=html||''; return { md: (div.textContent||'').trim()+'\n', imgStats: {total:0,embedded:0,failed:0,details:[]}, footnotes:[] }; } };
  var ReportMD   = NS.md && NS.md.report_build          || { build: function(parts){ return [parts.headerMd||'',parts.descMd||'',parts.hintsMd||'',parts.testcasesMd||'',parts.subsTableMd||'',parts.codeSectionsMd||''].join('\n'); } };

  var NBCells    = NS.nb && NS.nb.cells                 || { mdCell: function(md){return {cell_type:'markdown',metadata:{},source:md+'\n'};}, pyCell: function(code){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:code+'\n'};}, harness:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# harness\n'};}, reference:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# reference\n'};}, monacoCell:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# monaco\n'};}, storageCell:function(){return {cell_type:'code',metadata:{},execution_count:null,outputs:[],source:'# storage\n'};} };
  var NBBuild    = NS.nb && NS.nb.notebook_build        || { build: function(){ return { notebook:{cells:[],metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.x'}},nbformat:4,nbformat_minor:5}, filename:'LC-unknown.ipynb' }; } };

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
    if (t.MONACO) log.debug('monaco/top', JSON.stringify(dumpTop.__info || {}));
    if (nonEmpty(dumpTop.code)) {
      var vis = Selectors.visibleLangLabel && Selectors.visibleLangLabel();
      var label = resolveLabel(dumpTop.langId || '', vis || '');
      return { code: dumpTop.code, label: label, fence: fenceFromLabel(label), meta: { source:'monaco-top' } };
    }
    // Fallback to frames
    var dumpFr = await (MonacoFr.request ? MonacoFr.request(1400) : Promise.resolve({ code:'', langId:'' }));
    if (t.IFRAMES) log.debug('monaco/frame', JSON.stringify(dumpFr.__info || {}));
    if (nonEmpty(dumpFr.code)) {
      var vis2 = Selectors.visibleLangLabel && Selectors.visibleLangLabel();
      var label2 = resolveLabel(dumpFr.langId || '', vis2 || '');
      return { code: dumpFr.code, label: label2, fence: fenceFromLabel(label2), meta: { source:'monaco-frame' } };
    }
    return { code:'', label:'Text', fence:'text', meta: { source:'monaco-none' } };
  }

  /* ----------------------- Glossary quick capture (lightweight) ----------------------- */
  async function captureGlossaryPairs(limit){
    var rootDesc = Selectors.descriptionRoot ? Selectors.descriptionRoot() : null;
    var btns = Selectors.findGlossaryButtons ? Selectors.findGlossaryButtons(rootDesc) : [];
    if (!btns || !btns.length) return [];
    var max = Math.min(limit || 20, btns.length);
    var pairs = [];
    for (var i=0;i<max;i++){
      var btn = btns[i];
      try{
        var term = (btn.textContent || '').trim();
        var got = await (NS.ui && NS.ui.popup_glossary && NS.ui.popup_glossary.clickOpenAndGetHTML ? NS.ui.popup_glossary.clickOpenAndGetHTML(btn) : Promise.resolve({ html:'' }));
        var html = got.html || '';
        if (!nonEmpty(term) || !nonEmpty(html)) continue;
        // Convert popup HTML -> MD snippet (use HTML2MD for simplicity)
        var mdObj = await HTML2MD.convert(html, { inlineImages: getCfg().md && getCfg().md.INLINE_IMAGES });
        // basic label
        var label = term.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/^-+|-+$/g,'') || ('term-' + (i+1));
        pairs.push({ term: term, label: label, md: (mdObj.md || '').trim() });
      }catch(e){ log.debug('glossary/capture error', e && (e.message || e)); }
    }
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
  async function runPipeline(opts){
    opts = opts || {};
    var produceReport = !!opts.produceReport;
    var wantNotebook  = !!opts.wantNotebook;

    var slug = getSlugFromPath();
    if (!slug) throw new Error('No problem slug in URL.');

    log.info('pipeline/start', nowISO(), 'slug=', slug);

    // Start network calls
    var qP     = GQL.fetchQuestion(slug);
    var subsP  = GQL.fetchSubmissions(slug, { limit: (getCfg().limits && getCfg().limits.MAX_SUBMISSIONS) || 60, pageSize: (getCfg().limits && getCfg().limits.PAGE_SIZE) || 20 });
    var hintsP = GQL.fetchHints(slug).catch(function(){ return []; });

    // Fast glossary capture (non-blocking for long)
    var pairs = await captureGlossaryPairs((getCfg().GLOSSARY_CFG && getCfg().GLOSSARY_CFG.MAX_TERMS) || 20);

    var res   = await Promise.all([qP, subsP, hintsP]);
    var q     = res[0] || {};
    var subs  = Array.isArray(res[1]) ? res[1] : [];
    var hints = Array.isArray(res[2]) ? res[2] : [];

    // Detail fetch minimal (accepted first if needed)
    var rows = [];
    var detailsById = {};
    for (var i=0;i<subs.length;i++){
      var s = subs[i];
      rows.push({
        id: Number(s.id),
        statusDisplay: s.statusDisplay || '',
        timestamp: s.timestamp || null,
        lang: s.lang || ''
      });
      // lightweight detail
      try{
        var det = await GQL.fetchSubmissionDetails(Number(s.id));
        detailsById[s.id] = { code: det.code || '', lang: det.lang || s.lang || '' };
      }catch(e){}
    }

    // Monaco + storage
    var monacoEditor = await grabMonacoCodeAndLang();
    var storageScan  = StorageScan.scan(slug, q);

    // Convert description
    var descConv = await HTML2MD.convert(q && q.content || '', { inlineImages: getCfg().md && getCfg().md.INLINE_IMAGES, pairs: pairs });
    var descMd = nonEmpty(descConv.md) ? ('## Description\n\n' + descConv.md + '\n') : '';

    // Testcases (default/custom)
    var exA = q && q.exampleTestcases || '';
    var exB = q && q.sampleTestCase || '';
    var defaultBlob = [exA, exB].filter(nonEmpty).join('\n').trim();
    var capturedBlob = getCustomInput(slug);
    var testcasesMd = '## Testcases\n\n';
    testcasesMd += '### Default (from problem)\n\n```\n' + (defaultBlob || '(none)') + '\n```\n\n';
    if (nonEmpty(capturedBlob)) testcasesMd += '### Custom (captured via NetworkTap)\n\n```\n' + capturedBlob + '\n```\n\n';
    else testcasesMd += '### Custom (captured via NetworkTap)\n\n*(none captured yet — click **Run** on LC then retry)*\n\n';

    // Submissions table
    var subsTableMd = buildSubmissionsTable(q && q.titleSlug || slug, rows);

    // Per-submission code
    var parts = ['## Submission Code\n'];
    for (var j=0;j<rows.length;j++){
      var r = rows[j];
      var d = detailsById[r.id] || {};
      var langLabel = d.lang || r.lang || 'Text';
      var fence = fenceFromLabel(langLabel);
      var timeStr = toLocalStringFromEpochSec(r.timestamp);
      var header = '### Submission ' + r.id + ' — ' + (r.statusDisplay||'') + ' — ' + langLabel + (timeStr ? (' — ' + timeStr) : '');
      var codeRaw = nonEmpty(d.code) ? d.code : '';
      var safe = sanitizeCodeForMarkdown(codeRaw);
      parts.push(header + (nonEmpty(codeRaw) ? ('\n\n```' + fence + '\n' + safe + '\n```\n') : '\n\n*(no code available)*\n'));
    }
    var codeSectionsMd = parts.join('\n');

    // Hints
    var hintsMd = '';
    if (Array.isArray(hints) && hints.length) {
      var lines = hints.map(function(h,i){ return ' ' + (i+1) + '. ' + String(h).replace(/\s+/g,' ').trim(); }).join('\n');
      hintsMd = '## Hints\n\n' + lines + '\n';
    }

    // Header
    var solved = rows.some(function(r){ return /accepted/i.test(r.statusDisplay); });
    var headerMd = buildProblemHeader(q, solved);

    var reportMd = ReportMD.build({
      headerMd: headerMd,
      descMd: descMd,
      hintsMd: hintsMd,
      testcasesMd: testcasesMd,
      subsTableMd: subsTableMd,
      codeSectionsMd: codeSectionsMd
    });

    var nbOut = null;
    if (wantNotebook) {
      nbOut = NBBuild.build({
        question: q,
        solved: solved,
        descMd: descMd,
        hints: hints,
        testcases: { default: defaultBlob, custom: capturedBlob },
        subs: rows,
        detailsById: detailsById,
        monacoEditor: monacoEditor,
        storageScan: storageScan
      });
    }

    log.info('pipeline/finish', nowISO(), 'slug=', slug);
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
