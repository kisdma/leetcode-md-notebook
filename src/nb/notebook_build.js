/* src/nb/notebook_build.js
 * Jupyter Notebook builder.
 *
 * Responsibilities:
 *  - Produce a runnable .ipynb JSON with:
 *      1) Intro Markdown (problem, description, hints, tests, submissions table)
 *      2) Shared Python test harness
 *      3) Optional ReferenceSolution cell (latest Accepted, if Python)
 *      4) Current editor (Monaco) cell
 *      5) localStorage heuristic cell
 *      6) One cell per submission (source + run_all_cases if Python)
 *
 * Public API (LCMD.nb.notebook_build):
 *   skeleton() -> nb json
 *   mdCell(md) -> notebook markdown cell
 *   pyCell(code) -> notebook code cell
 *   combineUniqueTestcases(varNames, defaultBlob, customBlob) -> Array<object>
 *   buildHarnessCell(varNames, uniqCases) -> code cell
 *   buildReferenceCellIfAny(rows, detailsById) -> code cell | null
 *   monacoCell(monacoEditor) -> code cell
 *   localStorageCell(storageScan) -> code cell
 *   submissionCell(row, detailsById) -> code cell
 *   build(payload) -> { notebook, filename }
 *
 * Payload (build):
 *   {
 *     question, solved, descMd, hints,
 *     varNames, defaultBlob, customBlob,
 *     slug, rows, detailsById,
 *     monacoEditor, storageScan
 *   }
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var NBNS = NS.defineNS('nb');
  var existing = NBNS.notebook_build || NBNS.notebook;
  if (existing && existing.__ready__) return;

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;
  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  var MD = (NS.md && NS.md.report) || null;

  /* ----------------------------- utils ----------------------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }
  function toLocalStringFromEpochSec(sec){ try{ return sec ? new Date(sec * 1000).toLocaleString() : ''; }catch(_){ return ''; } }
  function fmtPct(x){ return (typeof x === 'number' && isFinite(x)) ? x.toFixed(2) : (x ?? ''); }

  function sanitizeCodeForMarkdown(code) {
    if (!nonEmpty(code)) return code || '';
    return String(code).replace(/(^|\n)```+/g, function(m, p1){ return p1 + '# ```'; });
  }

  function normalizeFenceFromLabel(label){
    if (MD && MD.normalizeFenceFromLabel) return MD.normalizeFenceFromLabel(label);
    // minimal local fallback
    var s = String(label||'').toLowerCase();
    if (s === 'python3' || /^python/.test(s)) return 'python';
    return 'text';
  }

  /* ---------------------------- notebook ---------------------------- */
  function skeleton(){
    var cfg = getCfg();
    var kernelspec = (cfg.nb && cfg.nb.kernelspec) || { display_name: 'Python 3', language: 'python', name: 'python3' };
    var langinfo   = (cfg.nb && cfg.nb.language_info) || { name: 'python', version: '3.x' };
    return {
      cells: [],
      metadata: {
        kernelspec: kernelspec,
        language_info: langinfo
      },
      nbformat: 4,
      nbformat_minor: 5
    };
  }
  function mdCell(md){
    return { cell_type: 'markdown', metadata: {}, source: md.endsWith('\n') ? md : md + '\n' };
  }
  function pyCell(code){
    return { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: code.endsWith('\n') ? code : code + '\n' };
  }

  function stringifyJson(x){ try { return JSON.stringify(x); } catch { return '[]'; } }

  /* ----------------------- testcases & harness ----------------------- */
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

    var obj1 = {};
    for (var i3=0;i3<V;i3++) obj1[varNames[i3] || ('var'+(i3+1))] = trimmed[i3] ?? '';
    return { cases: [obj1], usedLeadingCount: false };
  }

  function combineUniqueTestcases(varNames, defaultBlob, customBlob){
    var d = splitBlobIntoTestcases(defaultBlob, varNames).cases || [];
    var c = splitBlobIntoTestcases(customBlob, varNames).cases || [];
    var all = d.concat(c);
    var uniq = [];
    var seen = Object.create(null);
    for (var i=0;i<all.length;i++){
      var obj = all[i];
      var key = JSON.stringify(Object.keys(obj).sort().map(function(k){ return [k, String(obj[k] ?? '')]; }));
      if (seen[key]) continue;
      seen[key] = 1;
      uniq.push(obj);
    }
    return uniq;
  }

  function histogramPlotCell(histograms){
    var data = (histograms && typeof histograms === 'object') ? histograms : { charts: [] };
    var jsonStr = JSON.stringify(data);
    var literal = JSON.stringify(jsonStr);
    var code = [
      '# Histogram plotter (auto-generated)',
      'import json',
      'import math'
    ];
    code.push('_LCMD_HISTOGRAMS = json.loads(' + literal + ')');
    code = code.concat([
      '',
      'def _format_categories(labels):',
      '    formatted = []',
      '    for label in labels:',
      '        text = str(label).strip() if label is not None else ""',
      '        if len(text) > 30:',
      '            text = text[:27] + "..."',
      '        formatted.append(text)',
      '    return formatted',
      '',
      'def _plot_histograms(data):',
      '    charts = (data or {}).get("charts") or []',
      '    charts = [c for c in charts if (c.get("series") or [])]',
      '    if not charts:',
      '        print("No histogram data captured.")',
      '        return',
      '    try:',
      '        import matplotlib.pyplot as plt',
      '    except Exception as exc:',
      '        print("matplotlib is not available:", exc)',
      '        return',
      '    cols = 2 if len(charts) > 1 else 1',
      '    rows = (len(charts) + cols - 1) // cols',
      '    width = 12 if cols > 1 else 9',
      '    fig, axes = plt.subplots(rows, cols, figsize=(width, 4 * rows))',
      '    axes = axes.flatten() if hasattr(axes, "flatten") else [axes]',
      '    for index, chart in enumerate(charts):',
      '        ax = axes[index]',
      '        series_list = chart.get("series") or []',
      '        if not series_list:',
      '            title = str(chart.get("title") or chart.get("kind") or "Histogram").strip()',
      '            if title:',
      '                ax.set_title(title.title())',
      '            ax.text(0.5, 0.5, "(no data)", ha="center", va="center")',
      '            ax.set_axis_off()',
      '            continue',
      '        max_points = 0',
      '        for serie in series_list:',
      '            pts = serie.get("points") or []',
      '            if len(pts) > max_points:',
      '                max_points = len(pts)',
      '        rotation = 45',
      '        label_size = 10',
      '        sparse_every = 1',
      '        if max_points > 12:',
      '            rotation = 75 if max_points <= 24 else 90',
      '            label_size = 8 if max_points <= 24 else 7',
      '            sparse_every = max(1, int(math.ceil(max_points / 12.0)))',
      '        tick_positions = None',
      '        tick_labels = None',
      '        for serie in series_list:',
      '            points = serie.get("points") or []',
      '            if not points:',
      '                continue',
      '            categories = [str(pt.get("category", pt.get("index"))) for pt in points]',
      '            categories = _format_categories(categories)',
      '            values = [pt.get("value") for pt in points]',
      '            x = list(range(len(values)))',
      '            ax.bar(x, values, alpha=0.7)',
      '            if tick_positions is None or len(x) > len(tick_positions):',
      '                tick_positions = x',
      '                tick_labels = []',
      '                for idx, cat in enumerate(categories):',
      '                    if sparse_every > 1 and (idx % sparse_every) != 0:',
      '                        tick_labels.append("")',
      '                    else:',
      '                        tick_labels.append(cat)',
      '        if tick_positions is not None:',
      '            ax.set_xticks(tick_positions)',
      '            ax.set_xticklabels(tick_labels, rotation=rotation, ha="right")',
      '            ax.tick_params(axis="x", labelsize=label_size)',
      '            ax.margins(x=0.01)',
      '        title = str(chart.get("title") or chart.get("kind") or "Histogram").strip()',
      '        if title:',
      '            ax.set_title(title.title())',
      '        kind = (chart.get("kind") or "").lower()',
      '        if "memory" in kind:',
      '            ax.set_xlabel("Memory (MB)")',
      '        elif "runtime" in kind:',
      '            ax.set_xlabel("Runtime (ms)")',
      '        else:',
      '            ax.set_xlabel("Metric")',
      '        ax.set_ylabel("Submission Share (%)")',
      '        ax.grid(axis="y", alpha=0.2)',
      '    for extra_ax in axes[len(charts):]:',
      '        extra_ax.remove()',
      '    plt.tight_layout()',
      '    plt.show()',
      '',
      '_plot_histograms(_LCMD_HISTOGRAMS)',
      ''
    ]);
    return pyCell(code.join('\n'));
  }

  function buildHarnessCell(varNames, uniqCases){
    var PARAMS_JSON = stringifyJson(varNames || []);
    var CASES_JSON  = stringifyJson(uniqCases || []);
    var code = [
      '# Common Test Harness (auto-generated)',
      'import ast, json',
      'from typing import Any, Optional, List, Dict, Set, Tuple, Union, Iterable, Generator, Deque, DefaultDict',
      'from collections import deque, defaultdict, Counter',
      '',
      'try:',
      '    TreeNode',
      'except NameError:',
      '    class TreeNode:',
      '        def __init__(self, val=0, left=None, right=None):',
      '            self.val = val',
      '            self.left = left',
      '            self.right = right',
      '',
      'try:',
      '    ListNode',
      'except NameError:',
      '    class ListNode:',
      '        def __init__(self, val=0, next=None):',
      '            self.val = val',
      '            self.next = next',
      '',
      'try:',
      '    Node',
      'except NameError:',
      '    class Node:',
      '        def __init__(self, val=0, neighbors=None, children=None, next=None, random=None):',
      '            self.val = val',
      '            self.neighbors = list(neighbors) if neighbors else []',
      '            self.children = list(children) if children else []',
      '            self.next = next',
      '            self.random = random',
      '',
      '_PARAM_ORDER = json.loads(' + JSON.stringify(PARAMS_JSON) + ')',
      '_UNIQ_CASES  = json.loads(' + JSON.stringify(CASES_JSON) + ')',
      '',
      'def _coerce(s):',
      '    if isinstance(s, (int, float, list, dict, bool, type(None))):',
      '        return s',
      '    if not isinstance(s, str): return s',
      '    t = s.strip()',
      '    try:',
      '        return json.loads(t)',
      '    except Exception:',
      '        pass',
      '    try:',
      '        return ast.literal_eval(t)',
      '    except Exception:',
      '        pass',
      "    if ',' in t or ' ' in t:",
      "        parts=[p for p in t.replace(',', ' ').split() if p]",
      '        if parts and all(p.lstrip(\'-\').isdigit() for p in parts):',
      '            return [int(p) for p in parts]',
      '        return parts',
      '    return t',
      '',
      'def _normalize(x):',
      '    try:',
      '        import numpy as _np',
      '        if isinstance(x, _np.ndarray): x = x.tolist()',
      '    except Exception:',
      '        pass',
      '    if isinstance(x, (list, tuple)):',
      '        return [_normalize(v) for v in x]',
      '    if isinstance(x, dict):',
      '        return {k:_normalize(v) for k,v in x.items()}',
      '    return x',
      '',
      'def _pick_callable(cls):',
      '    try:',
      '        inst = cls()',
      '    except Exception as e:',
      '        print("Solution() not constructible:", e); return None, None',
      '    for name in dir(inst):',
      "        if name.startswith('_'): continue",
      '        f = getattr(inst, name)',
      '        if callable(f):',
      '            return inst, f',
      '    return inst, None',
      '',
      'def _run_case_with(cls, args_dict):',
      '    inst, fn = _pick_callable(cls)',
      '    if fn is None:',
      "        return {'error': 'no callable method'}",
      '    kw = {}',
      '    for k in _PARAM_ORDER:',
      '        if k in args_dict:',
      '            kw[k] = _coerce(args_dict[k])',
      '    try:',
      '        if kw:',
      '            out = fn(**kw)',
      '            args_repr = kw',
      '        else:',
      '            pos = [_coerce(args_dict[k]) for k in args_dict]',
      '            out = fn(*pos)',
      '            args_repr = pos',
      "        return {'ok': True, 'out': _normalize(out), 'args': args_repr}",
      '    except TypeError:',
      '        pos = [_coerce(args_dict[k]) for k in _PARAM_ORDER if k in args_dict]',
      '        try:',
      '            out = fn(*pos)',
      "            return {'ok': True, 'out': _normalize(out), 'args': pos}",
      '        except Exception as e:',
      "            return {'error': str(e)}",
      '    except Exception as e:',
      "        return {'error': str(e)}",
      '',
      'def _get_reference_cls():',
      "    return globals().get('ReferenceSolution', None)",
      '',
      'def run_all_cases(SolutionClass):',
      '    ref_cls = _get_reference_cls()',
      '    passed = 0; total = len(_UNIQ_CASES)',
      '    for i,case in enumerate(_UNIQ_CASES,1):',
      '        print(f"Case {i}:")',
      '        res = _run_case_with(SolutionClass, case)',
      "        if 'error' in res:",
      '            print("  ERROR:", res[\'error\']); print("-"*60); continue',
      '        print("  args:", res[\'args\'])',
      '        out = res[\'out\']',
      '        if ref_cls:',
      '            exp = _run_case_with(ref_cls, case)',
      "            if 'error' in exp:",
      '                print("  REF ERROR:", exp[\'error\'])',
      '                print("  got:", out)',
      '                print("-"*60); continue',
      '            same = out == exp[\'out\']',
      '            print("  got:", out)',
      '            print("  exp:", exp[\'out\'])',
      '            print("   ", "PASS" if same else "FAIL")',
      '            if same: passed += 1',
      '        else:',
      '            print("  out:", out)',
      '            passed += 1',
      '        print("-"*60)',
      '    if ref_cls:',
      '        print(f"Summary: {passed}/{total} tests passed vs reference.")',
      '    else:',
      '        print(f"Summary: executed {total} tests (no reference available).")',
      ''
    ].join('\n');
    return pyCell(code);
  }

  /* ---------------------------- reference ---------------------------- */
  function buildReferenceCellIfAny(rows, detailsById){
    var acRows = (rows || []).filter(function(r){ return /accepted/i.test(r.statusDisplay || ''); });
    if (!acRows.length) return null;
    var latest = acRows.reduce(function(a,b){ return ((a.timestamp||0) >= (b.timestamp||0)) ? a : b; });
    var det = (detailsById && detailsById[latest.id]) || {};
    var lang = det.lang || latest.lang || '';
    var timeStr = toLocalStringFromEpochSec(latest.timestamp);

    if (!/^python/i.test(lang) || !nonEmpty(det.code)){
      var msg = 'print("Latest Accepted (#'+latest.id+') is not Python; ReferenceSolution unavailable.")';
      var hdr = [
        '# Reference (Latest Accepted) ' + latest.id,
        '# Status: ' + (latest.statusDisplay || ''),
        '# Lang: ' + lang,
        '# Time: ' + (timeStr || ''),
        ''
      ].join('\n');
      return pyCell(hdr + '\n' + msg + '\n');
    }

    // Escape triple-quotes safely
    var escaped = det.code.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
    var hdr2 = [
      '# Reference (Latest Accepted) ' + latest.id,
      '# Status: ' + (latest.statusDisplay || ''),
      '# Lang: ' + lang,
      '# Time: ' + (timeStr || ''),
      '# This cell defines ReferenceSolution = Solution',
      ''
    ].join('\n');
    var body = [
      '# --- begin accepted code (escaped literal) ---',
      'acc_src = """' + escaped + '"""',
      'exec(acc_src, globals(), globals())',
      'try:',
      '    ReferenceSolution = Solution',
      '    print("ReferenceSolution is set from latest Accepted.")',
      'except Exception as e:',
      '    print("Could not set ReferenceSolution:", e)',
      '# --- end accepted code ---',
      ''
    ].join('\n');
    return pyCell(hdr2 + '\n' + body);
  }

  /* ------------------------ context source cells ------------------------ */
  function monacoCell(monacoEditor){
    var lang = (monacoEditor && monacoEditor.label) || '';
    var commentHdr = [
      '# Current Editor Code (Monaco)',
      '# Source: ' + ((monacoEditor && monacoEditor.meta && monacoEditor.meta.source) || 'monaco'),
      '# Lang: ' + lang,
      ''
    ].join('\n');

    if (/^python/i.test(lang) && monacoEditor && nonEmpty(monacoEditor.code)){
      return pyCell(commentHdr + '\n' + monacoEditor.code + '\n\nrun_all_cases(Solution)\n');
    }
    var shown = (monacoEditor && nonEmpty(monacoEditor.code)) ? monacoEditor.code : '(no code captured)';
    var body = [
      'print("Non-Python editor language; showing source but not executing.")',
      'SRC = r"""\\',
      sanitizeCodeForMarkdown(shown).replace(/\\/g,'\\\\').replace(/"""/g,'\\"""'),
      '\\n"""',
      'print(SRC)',
      ''
    ].join('\n');
    return pyCell(commentHdr + '\n' + body);
  }

  function localStorageCell(storageScan){
    var hdr = [
      '# Current Code from localStorage (heuristic)',
      storageScan && storageScan.meta && storageScan.meta.key ? '# Key: ' + storageScan.meta.key : '# Key: (unknown)',
      ''
    ].join('\n');

    if (!storageScan || !storageScan.ok || !nonEmpty(storageScan.code)){
      return pyCell(hdr + 'print("No plausible code found in localStorage.")\n');
    }

    function inferLang(t){
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
    var lang = inferLang(storageScan.code);

    if (/^python/i.test(lang)){
      return pyCell(hdr + '\n' + storageScan.code + '\n\nrun_all_cases(Solution)\n');
    }
    var shown = storageScan.code;
    var body = [
      'print("LocalStorage code not Python; showing source but not executing.")',
      'SRC = r"""\\',
      sanitizeCodeForMarkdown(shown).replace(/\\/g,'\\\\').replace(/"""/g,'\\"""'),
      '\\n"""',
      'print(SRC)',
      ''
    ].join('\n');
    return pyCell(hdr + '\n' + body);
  }

  /* --------------------------- submissions --------------------------- */
  function submissionCell(r, detailsById){
    var d = (detailsById && detailsById[r.id]) || {};
    var lang = d.lang || r.lang || '';
    var timeStr = toLocalStringFromEpochSec(r.timestamp);
    var hdr = [
      '# Submission ' + r.id,
      '# Status: ' + (r.statusDisplay || ''),
      '# Lang: ' + lang,
      '# Time: ' + (timeStr || ''),
      (r.runtimeMs != null ? '# Runtime (ms): ' + r.runtimeMs : '# Runtime: ' + (r.runtimeStr || '')),
      (r.runtimeBeats != null ? '# Runtime Beats %: ' + fmtPct(r.runtimeBeats) : '# Runtime Beats %:'),
      (r.memoryMB != null ? '# Memory (MB): ' + r.memoryMB : '# Memory: ' + (r.memoryStr || '')),
      (r.memoryBeats != null ? '# Memory Beats %: ' + fmtPct(r.memoryBeats) : '# Memory Beats %:'),
      (r.note ? '# Notes: ' + String(r.note).replace(/\n+/g,' ') : '# Notes:'),
      ''
    ].join('\n');

    if (/^python/i.test(lang) && nonEmpty(d.code)){
      return pyCell(hdr + '\n' + d.code + '\n\nrun_all_cases(Solution)\n');
    }
    var shown = nonEmpty(d.code) ? d.code : '(no code available for this submission)';
    var body = [
      'print("Non-Python submission; showing source but not executing.")',
      'SRC = r"""\\',
      sanitizeCodeForMarkdown(shown).replace(/\\/g,'\\\\').replace(/"""/g,'\\"""'),
      '\\n"""',
      'print(SRC)',
      ''
    ].join('\n');
    return pyCell(hdr + '\n' + body);
  }

  /* ------------------------ first markdown cell ------------------------ */
  function firstMarkdownCell(payload){
    var q = payload.question || {};
    var rows = Array.isArray(payload.rows) ? payload.rows : [];
    var mdParts = [];

    if (MD && MD.buildFullReport) {
      // Use report builder but omit Monaco/LocalStorage in the first cell:
      // We'll still use MD.buildFullReport then strip those sections, or
      // build the parts manually using MD section helpers.
      var md = '';
      md += MD.problemHeader(q, !!payload.solved);
      md += MD.descriptionBlock(payload.descMd || '', payload.imgStats || null);
      md += MD.hintsSection(payload.hints || []);
      md += MD.testcasesSection(payload.varNames || [], payload.defaultBlob || '', payload.customBlob || '');
      md += MD.submissionsTable(payload.slug || q.titleSlug || '', rows, { includeLang: getCfg().md && getCfg().md.includeLangInMd });
      md += '_The next cell defines a shared test harness. Each Python solution cell calls `run_all_cases(Solution)` to execute all unique test cases. If a Python Accepted submission exists, it is added as a Reference and used for validation._\n';
      return mdCell(md);
    }

    // Fallback (should rarely happen): just put a small header
    var fallback = '# ' + (q.title || q.titleSlug || 'LeetCode Problem') + '\n\n';
    return mdCell(fallback);
  }

  /* ------------------------------- build ------------------------------- */
  function build(payload){
    payload = payload || {};
    var q = payload.question || {};
    var rows = Array.isArray(payload.rows) ? payload.rows : [];

    var nb = skeleton();

    // 1) Intro MD
    nb.cells.push(firstMarkdownCell(payload));

    // 2) Harness
    var uniqCases = combineUniqueTestcases(payload.varNames || [], payload.defaultBlob || '', payload.customBlob || '');
    nb.cells.push(buildHarnessCell(payload.varNames || [], uniqCases));
    nb.cells.push(histogramPlotCell(payload.histograms || {}));

    // 3) Reference (optional)
    var refCell = buildReferenceCellIfAny(rows, payload.detailsById || {});
    if (refCell) nb.cells.push(refCell);

    // 4) Monaco + 5) localStorage
    nb.cells.push(monacoCell(payload.monacoEditor || {}));
    nb.cells.push(localStorageCell(payload.storageScan || {}));

    // 6) Each submission
    for (var i=0;i<rows.length;i++){
      nb.cells.push(submissionCell(rows[i], payload.detailsById || {}));
    }

    var fname = 'LC' + (q.questionId || '0000') + '-' + (q.titleSlug || payload.slug || 'unknown') + '.ipynb';
    return { notebook: nb, filename: fname };
  }

  /* ------------------------------ export ------------------------------ */
  var API = {
    __ready__: true,
    skeleton: skeleton,
    mdCell: mdCell,
    pyCell: pyCell,
    combineUniqueTestcases: combineUniqueTestcases,
    buildHarnessCell: buildHarnessCell,
    histogramPlotCell: histogramPlotCell,
    buildReferenceCellIfAny: buildReferenceCellIfAny,
    monacoCell: monacoCell,
    localStorageCell: localStorageCell,
    submissionCell: submissionCell,
    build: build
  };

  NBNS.notebook_build = API;
  NBNS.notebook = API; // legacy alias

})(window.LCMD);

