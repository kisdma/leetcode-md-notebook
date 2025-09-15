/* src/md/report_build.js
 * Markdown report composition helpers.
 *
 * Responsibilities:
 *  - Create consistent, polished Markdown sections from pipeline data.
 *  - Keep rendering decisions centralized (headings, tables, code fences).
 *  - Remain pure & deterministic (no DOM access, no network).
 *
 * Public API (LCMD.md.report):
 *   sanitizeCodeForMarkdown(code) -> string
 *   fenceFromLabelOrId(labelOrId) -> string
 *   normalizeFenceFromLabel(label) -> string
 *
 *   problemHeader(question, solved:boolean) -> string
 *   descriptionBlock(descMd, imgStats?) -> string
 *   hintsSection(hints:string[]) -> string
 *   testcaseTable(title, blob, varNames[]) -> string
 *   testcasesSection(varNames[], defaultBlob, customBlob) -> string
 *   submissionsTable(slug, rows[], opts?) -> string
 *   submissionCodeBlocks(rows[], detailsById:{[id]:{code,lang}}, opts?) -> string
 *   monacoSection(monacoEditor) -> string
 *   storageSection(storageScan) -> string
 *
 *   buildFullReport({
 *     question, solved, descMd, imgStats, hints, varNames,
 *     defaultBlob, customBlob, slug, rows, detailsById,
 *     monacoEditor, storageScan
 *   }, opts?) -> string
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var MD = NS.defineNS('md');
  if (MD.report && MD.report.__ready__) return;

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;
  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  /* ----------------------------- utils ----------------------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }
  function clip(s, n){ s = s || ''; return s.length > n ? (s.slice(0, n-1) + '…') : s; }
  function toLocalStringFromEpochSec(sec){ try{ return sec ? new Date(sec * 1000).toLocaleString() : ''; }catch(_){ return ''; } }
  function fmtPct(x){ return (typeof x === 'number' && isFinite(x)) ? x.toFixed(2) : (x ?? ''); }

  function sanitizeCodeForMarkdown(code) {
    if (!nonEmpty(code)) return code || '';
    // Guard accidental code fences inside code, which can break the MD section that contains it.
    return String(code).replace(/(^|\n)```+/g, function(m, p1){ return p1 + '# ```'; });
  }

  var LANG_MAP = {
    python:{label:'Python',fence:'python',aliases:['python3','py']}, cpp:{label:'C++',fence:'cpp',aliases:['c++']}, c:{label:'C',fence:'c'},
    java:{label:'Java',fence:'java'}, javascript:{label:'JavaScript',fence:'javascript',aliases:['js']}, typescript:{label:'TypeScript',fence:'typescript',aliases:['ts']},
    csharp:{label:'C#',fence:'csharp',aliases:['cs','c#']}, go:{label:'Go',fence:'go',aliases:['golang']}, kotlin:{label:'Kotlin',fence:'kotlin'},
    swift:{label:'Swift',fence:'swift'}, php:{label:'PHP',fence:'php'}, ruby:{label:'Ruby',fence:'ruby'}, rust:{label:'Rust',fence:'rust'},
    scala:{label:'Scala',fence:'scala'}, r:{label:'R',fence:'r'}, sql:{label:'SQL',fence:'sql'}, bash:{label:'bash',fence:'bash',aliases:['sh','shell']},
    text:{label:'Text',fence:'text'}
  };

  function fenceFromLabelOrId(labelOrId){
    if (!nonEmpty(labelOrId)) return 'text';
    var s = String(labelOrId).toLowerCase();
    if (s === 'python3') return 'python';
    if (LANG_MAP[s]) return LANG_MAP[s].fence;
    // search aliases
    for (var k in LANG_MAP){
      if (!Object.prototype.hasOwnProperty.call(LANG_MAP,k)) continue;
      var info = LANG_MAP[k];
      if (info.aliases && info.aliases.indexOf(s) !== -1) return info.fence;
    }
    return 'text';
  }
  function normalizeFenceFromLabel(label){
    var f = fenceFromLabelOrId(label || '');
    if (/^python/i.test(label || '')) return 'python';
    return f || 'text';
  }

  function inferLangFromCode(t){
    if (!t) return 'Text';
    if (/^\s*#include\b/.test(t) || /\bstd::\w+/.test(t)) return 'C++';
    if (/\bpublic\s+class\s+\w+/.test(t) || /\bSystem\.out\.println/.test(t)) return 'Java';
    if (/\bdef\s+\w+\s*\(/.test(t) || /\bclass\s+Solution\b/.test(t)) return 'Python3';
    if (/\busing\s+System\b/.test(t) || /\bConsole\.WriteLine/.test(t)) return 'C#';
    if (/\bfunction\b|\b=>\s*\{/.test(t) && /:\s*\w+/.test(t)) return 'TypeScript';
    if (/\bfunction\b|\b=>\s*\{/.test(t)) return 'JavaScript';
    if (/\bpackage\s+\w+/.test(t) || /\bfunc\s+\w+\s*\(/.test(t)) return 'Go';
    if (/\bfn\s+\w+\s*\(/.test(t) || /\blet\s+mut\b/.test(t)) return 'Rust';
    if (/\bfun\s+\w+\s*\(/.test(t) || /\bclass\s+\w+\s*:\s*\w+/.test(t)) return 'Kotlin';
    if (/<\?php/.test(t)) return 'PHP';
    if (/\bSELECT\b.*\bFROM\b/i.test(t)) return 'SQL';
    return 'Text';
  }

  /* --------------------------- sections --------------------------- */

  function problemHeader(q, solved){
    var id = q && q.questionId ? String(q.questionId).trim() : '';
    var title = (q && (q.title || q.titleSlug)) || 'Unknown Title';
    var shownTitle = id ? (id + '. ' + title) : title;
    var diff = (q && q.difficulty) || 'Unknown';
    var s = (q && q.statsObj) || {};
    var totalAcc = s.totalAccepted ?? s.totalAcceptedRaw ?? '';
    var totalSubs= s.totalSubmission ?? s.totalSubmissionRaw ?? '';
    var acRate = (typeof s.acRate === 'string' && s.acRate) ? s.acRate : '';
    var topics = ((q && q.topicTags) || []).map(function(t){ return t.name; }).filter(Boolean).join(', ');
    var similar = ((q && q.similar) || []).map(function(sp){
      var slug = sp.titleSlug || '';
      var link = slug ? ('https://leetcode.com/problems/' + slug + '/description/') : '';
      return '- ' + (sp.title || '') + ' — ' + (sp.difficulty || '') + (link ? (' — [link](' + link + ')') : '');
    }).join('\n');

    var solvedStr = solved ? '✅ Solved' : '⬜ Not solved (in recent history)';
    var md = '# ' + shownTitle + '\n\n' +
             '**Difficulty:** ' + diff + '  \n' +
             '**Status:** ' + solvedStr + '\n\n' +
             '**Stats:** Accepted: ' + totalAcc + ' &nbsp;&nbsp; Submissions: ' + totalSubs + ' &nbsp;&nbsp; Acceptance: ' + acRate + '\n\n';
    if (topics) md += '**Topics:** ' + topics + '\n\n';
    if (similar) md += '**Similar Problems:**\n' + similar + '\n\n';
    return md;
  }

  function descriptionBlock(descMd, imgStats){
    var md = '';
    if (nonEmpty(descMd)) {
      md += descMd;
      if (imgStats && typeof imgStats.total === 'number' && imgStats.total > 0) {
        var warn = imgStats.failed ? (' — ⚠️ ' + imgStats.failed + ' not embedded (left as remote links)') : '';
        md += '> **Images:** embedded ' + (imgStats.embedded || 0) + '/' + imgStats.total + warn + '\n\n';
      } else {
        md += '\n';
      }
    }
    return md;
  }

  function hintsSection(hints){
    if (!Array.isArray(hints) || hints.length === 0) return '';
    var lines = hints.map(function(h, i){ return ' ' + (i+1) + '. ' + String(h).replace(/\s+/g,' ').trim(); }).join('\n');
    return '## Hints\n\n' + lines + '\n\n';
  }

  function normalizeBlobToLines(blob){
    if (!nonEmpty(blob)) return [];
    return String(blob).replace(/\r\n/g,'\n').split('\n');
  }
  function isIntString(s){ return /^-?\d+$/.test(String(s).trim()); }

  function splitBlobIntoTestcases(blob, varNames){
    var lines = normalizeBlobToLines(blob);
    var V = Math.max(1, (varNames && varNames.length) || 1);
    if (!lines.length) return { cases:[], usedLeadingCount:false };
    var trimmed = lines.slice();
    while (trimmed.length && trimmed[trimmed.length-1].trim() === '') trimmed.pop();

    if (trimmed.length >= 1 && isIntString(trimmed[0])) {
      var T = parseInt(trimmed[0], 10);
      var rem = trimmed.length - 1;
      if (rem % V === 0 && rem / V === T) {
        var values = trimmed.slice(1);
        var cases = [];
        for (var t=0;t<T;t++){
          var off = t * V; var obj = {};
          for (var i=0;i<V;i++) obj[varNames[i] || ('var'+(i+1))] = values[off+i] ?? '';
          cases.push(obj);
        }
        return { cases: cases, usedLeadingCount: true };
      }
    }

    if (trimmed.length % V === 0) {
      var T2 = trimmed.length / V;
      var cases2 = [];
      for (var t2=0;t2<T2;t2++){
        var off2 = t2 * V; var obj2 = {};
        for (var i2=0;i2<V;i2++) obj2[varNames[i2] || ('var'+(i2+1))] = trimmed[off2+i2] ?? '';
        cases2.push(obj2);
      }
      return { cases: cases2, usedLeadingCount: false };
    }

    var obj1 = {}; for (var i3=0;i3<V;i3++) obj1[varNames[i3] || ('var'+(i3+1))] = trimmed[i3] ?? '';
    return { cases: [obj1], usedLeadingCount: false };
  }

  function renderTestcaseTable(title, blob, varNames){
    if (!nonEmpty(blob)) return '### ' + title + '\n\n*(none)*\n\n';
    var s = splitBlobIntoTestcases(blob, varNames);
    var usedLeadingCount = s.usedLeadingCount;
    var header = '### ' + title + '\n\n' +
                 '**Variables:** ' + varNames.join(', ') + (usedLeadingCount ? '  \n*(first line treated as testcase count)*' : '') + '\n\n';
    var head = '| # | ' + varNames.map(function(v){ return '`'+v+'`'; }).join(' | ') + ' |\n' +
               '|:-:|' + varNames.map(function(){ return '---'; }).join('|') + '|\n';
    var rows = s.cases.map(function(c, i){
      return '| ' + (i+1) + ' | ' + varNames.map(function(v){
        return String(c[v] ?? '').replace(/\|/g,'\\|');
      }).join(' | ') + ' |';
    }).join('\n');
    var raw = '\n**Raw:**\n\n```\n' + blob + '\n```\n\n';
    return header + head + rows + '\n' + raw;
  }

  function testcasesSection(varNames, defaultBlob, customBlob){
    var md = '## Testcases\n\n**Variables:** ' + varNames.join(', ') + '\n\n';
    md += renderTestcaseTable('Default (from problem)', defaultBlob, varNames);
    if (nonEmpty(customBlob)) md += renderTestcaseTable('Custom (captured via NetworkTap)', customBlob, varNames);
    else md += '### Custom (captured via NetworkTap)\n\n*(none captured yet — click **Run**, then press **Copy Report** / **Save .ipynb** again)*\n\n';
    return md;
  }

  function submissionsTable(slug, rows, opts){
    var cfg = getCfg();
    var includeLang = (opts && 'includeLang' in opts) ? !!opts.includeLang
                      : !!(cfg.md && cfg.md.includeLangInMd);
    var clipNotes = (cfg.md && cfg.md.clipNotesChars) || 180;

    var langHdr = includeLang ? ' | Lang' : '';
    var langSep = includeLang ? ' |:-----' : '';
    var header = '## Submissions — `' + (slug || '') + '`\n\n' +
      '| # | ID | Status' + langHdr + ' | Time | Runtime (ms) | Runtime Beats % | Memory (MB) | Memory Beats % | Notes |\n' +
      '|:-:|---:|:------' + langSep + '|:-----|------------:|----------------:|-----------:|---------------:|:------|\n';

    var lines = rows.map(function(r){
      var timeStr = toLocalStringFromEpochSec(r.timestamp);
      var lang = includeLang ? (' | ' + (r.lang || '')) : '';
      var rt = (/accepted/i.test(r.statusDisplay) && r.runtimeMs != null) ? String(r.runtimeMs) : '';
      var rb = (/accepted/i.test(r.statusDisplay) && r.runtimeBeats != null) ? fmtPct(r.runtimeBeats) : '';
      var mm = (/accepted/i.test(r.statusDisplay) && r.memoryMB != null) ? String(r.memoryMB) : '';
      var mb = (/accepted/i.test(r.statusDisplay) && r.memoryBeats != null) ? fmtPct(r.memoryBeats) : '';
      var note = clip(String((r.note || '')).replace(/\n+/g,' '), clipNotes);
      return '| ' + r.idx + ' | ' + r.id + ' | ' + (r.statusDisplay || '') + lang + ' | ' + timeStr + ' | ' + rt + ' | ' + rb + ' | ' + mm + ' | ' + mb + ' | ' + note + ' |';
    });
    return header + lines.join('\n') + '\n\n';
  }

  function submissionCodeBlocks(rows, detailsById, opts){
    var cfg = getCfg();
    var collapse = (opts && 'collapse' in opts) ? !!opts.collapse
                   : !!(cfg.md && cfg.md.codeBlockCollapse);
    var out = ['## Submission Code'];
    for (var i=0;i<rows.length;i++){
      var r = rows[i];
      var d = (detailsById && detailsById[r.id]) || {};
      var langLabel = d.lang || r.lang || 'Text';
      var fence = normalizeFenceFromLabel(langLabel);
      var timeStr = toLocalStringFromEpochSec(r.timestamp);
      var header = '### Submission ' + r.id + ' — ' + (r.statusDisplay || '') + ' — ' + langLabel + (timeStr ? (' — ' + timeStr) : '');
      var codeRaw = nonEmpty(d.code) ? d.code : '';
      var safe = sanitizeCodeForMarkdown(codeRaw);
      var body = nonEmpty(codeRaw)
        ? (collapse
            ? '<details><summary>show code</summary>\n\n```' + fence + '\n' + safe + '\n```\n\n</details>'
            : '\n```' + fence + '\n' + safe + '\n```\n')
        : '\n*(no code available)*\n';
      out.push(header + body + '\n');
    }
    return out.join('\n');
  }

  function monacoSection(monacoEditor){
    var md = '## Current Editor Code — Monaco\n\n';
    if (monacoEditor && nonEmpty(monacoEditor.code)){
      var fence = monacoEditor.fence || normalizeFenceFromLabel(monacoEditor.label || '');
      var src = monacoEditor.meta && monacoEditor.meta.source ? monacoEditor.meta.source : 'monaco';
      var safe = sanitizeCodeForMarkdown(monacoEditor.code);
      md += '*Source:* `' + src + '`' + (monacoEditor.label ? (' &nbsp;&nbsp; *Lang:* ' + monacoEditor.label) : '') + '\n\n';
      md += '```' + fence + '\n' + safe + '\n```\n\n';
    } else {
      md += '*(not found — try focusing the editor or switching to the code tab)*\n\n';
    }
    return md;
  }

  function storageSection(storageScan){
    var md = '## Current Editor Code — localStorage (heuristic)\n\n';
    if (storageScan && storageScan.ok && nonEmpty(storageScan.code)){
      var lbl = inferLangFromCode(storageScan.code);
      var fence = normalizeFenceFromLabel(lbl);
      var meta = (storageScan.meta && storageScan.meta.key) ? ('*Key:* `' + storageScan.meta.key + '`') : '*Key:* (unknown)';
      var safe = sanitizeCodeForMarkdown(storageScan.code);
      md += meta + (lbl ? (' &nbsp;&nbsp; *Lang guess:* ' + lbl) : '') + '\n\n';
      md += '```' + fence + '\n' + safe + '\n```\n\n';
    } else {
      var why = (storageScan && storageScan.meta && storageScan.meta.error) ? (' — ' + storageScan.meta.error) : '';
      md += '*(no plausible code found in localStorage' + why + ')*\n\n';
    }
    return md;
  }

  /* ------------------------- full composer ------------------------- */
  function buildFullReport(P, opts){
    // P: payload from pipeline
    // Ensure graceful defaults
    P = P || {};
    var q = P.question || {};
    var rows = Array.isArray(P.rows) ? P.rows : [];
    var solved = !!P.solved;

    var md = '';
    md += problemHeader(q, solved);
    md += descriptionBlock(P.descMd || '', P.imgStats || null);
    md += hintsSection(P.hints || []);
    md += testcasesSection(P.varNames || [], P.defaultBlob || '', P.customBlob || '');
    md += monacoSection(P.monacoEditor || null);
    md += storageSection(P.storageScan || null);
    md += submissionsTable(P.slug || q.titleSlug || '', rows, opts || {});
    md += submissionCodeBlocks(rows, P.detailsById || {}, opts || {});
    return md;
  }

  /* --------------------------- export --------------------------- */
  MD.report = {
    __ready__: true,
    // utils
    sanitizeCodeForMarkdown: sanitizeCodeForMarkdown,
    fenceFromLabelOrId: fenceFromLabelOrId,
    normalizeFenceFromLabel: normalizeFenceFromLabel,
    // sections
    problemHeader: problemHeader,
    descriptionBlock: descriptionBlock,
    hintsSection: hintsSection,
    testcaseTable: renderTestcaseTable,
    testcasesSection: testcasesSection,
    submissionsTable: submissionsTable,
    submissionCodeBlocks: submissionCodeBlocks,
    monacoSection: monacoSection,
    storageSection: storageSection,
    // full
    buildFullReport: buildFullReport
  };

})(window.LCMD);
