/* src/nb/cells.js
 * Primitive Jupyter cell builders and common notebook cell templates.
 *
 * Public API (LCMD.nb.cells):
 *   mdCell(md) -> nb markdown cell
 *   pyCell(code) -> nb code cell
 *   sanitizeCodeForMarkdown(code) -> string
 *   combineUniqueTestcases(varNames, defaultBlob, customBlob) -> Array<object>
 *   harnessCell(varNames, uniqCases) -> code cell
 *   referenceCellIfAny(rows, detailsById) -> code cell | null
 *   monacoCell(monacoEditor) -> code cell
 *   localStorageCell(storageScan) -> code cell
 *   submissionCell(row, detailsById) -> code cell
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var NBNS = NS.defineNS('nb');
  if (NBNS.cells && NBNS.cells.__ready__) return;

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };

  /* ----------------------------- utils ----------------------------- */
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }
  function toLocalStringFromEpochSec(sec){ try{ return sec ? new Date(sec * 1000).toLocaleString() : ''; }catch(_){ return ''; } }
  function fmtPct(x){ return (typeof x === 'number' && isFinite(x)) ? x.toFixed(2) : (x ?? ''); }

  function sanitizeCodeForMarkdown(code) {
    if (!nonEmpty(code)) return code || '';
    // Prevent accidental ``` inside content from breaking surrounding cells
    return String(code).replace(/(^|\n)```+/g, function(_, p1){ return p1 + '# ```'; });
  }
  function stringifyJson(x){ try { return JSON.stringify(x); } catch { return '[]'; } }

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
        for (var i2=0;i<V;i++) obj2[varNames[i2] || ('var'+(i2+1))] = trimmed[off2+i2] ?? '';
        cases2.push(obj2);
      }
      return { cases: cases2, usedLeadingCount: false };
    }

    var obj1 = {};
    for (var i3=0;i3<V;i3++) obj1[varNames[i3] || ('var'+(i3+1))] = trimmed[i3] ?? '';
    return { cases: [obj1], usedLeadingCount: false };
  }

  /* --------------------------- cell makers --------------------------- */
  function mdCell(md){
    return { cell_type: 'markdown', metadata: {}, source: md.endsWith('\n') ? md : md + '\n' };
  }
  function pyCell(code){
    return { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: code.endsWith('\n') ? code : code + '\n' };
  }

  /* ------------------------ shared harness cell ----------------------- */
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

  function harnessCell(varNames, uniqCases){
    var PARAMS_JSON = stringifyJson(varNames || []);
    var CASES_JSON  = stringifyJson(uniqCases || []);
    var code = [
      '# Common Test Harness (auto-generated)',
      'import ast, json',
      'from typing import List',
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
      '    # Prefer first public callable method',
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
      '        print(f\"Case {i}:\")',
      '        res = _run_case_with(SolutionClass, case)',
      "        if 'error' in res:",
      '            print(\"  ERROR:\", res[\'error\']); print(\"-\"*60); continue',
      '        print(\"  args:\", res[\'args\'])',
      '        out = res[\'out\']',
      '        if ref_cls:',
      '            exp = _run_case_with(ref_cls, case)',
      "            if 'error' in exp:",
      '                print(\"  REF ERROR:\", exp[\'error\'])',
      '                print(\"  got:\", out)',
      '                print(\"-\"*60); continue',
      '            same = out == exp[\'out\']',
      '            print(\"  got:\", out)',
      '            print(\"  exp:\", exp[\'out\'])',
      '            print(\"   \", \"PASS\" if same else \"FAIL\")',
      '            if same: passed += 1',
      '        else:',
      '            print(\"  out:\", out)',
      '            passed += 1',
      '        print(\"-\"*60)',
      '    if ref_cls:',
      '        print(f\"Summary: {passed}/{total} tests passed vs reference.\")',
      '    else:',
      '        print(f\"Summary: executed {total} tests (no reference available).\")',
      ''
    ].join('\n');
    return pyCell(code);
  }

  /* -------------------------- reference cell -------------------------- */
  function referenceCellIfAny(rows, detailsById){
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

  /* ----------------------- context/source cells ----------------------- */
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

  /* --------------------------- submission cell --------------------------- */
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

  /* ----------------------------- export ----------------------------- */
  NBNS.cells = {
    __ready__: true,
    // primitives
    mdCell: mdCell,
    pyCell: pyCell,
    sanitizeCodeForMarkdown: sanitizeCodeForMarkdown,
    // tests & harness
    combineUniqueTestcases: combineUniqueTestcases,
    harnessCell: harnessCell,
    // major cell templates
    referenceCellIfAny: referenceCellIfAny,
    monacoCell: monacoCell,
    localStorageCell: localStorageCell,
    submissionCell: submissionCell
  };

})(window.LCMD);
