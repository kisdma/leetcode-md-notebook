/* src/util/langmap.js
 * Language label <-> fence mapping and heuristics.
 *
 * Public API (LCMD.util.langmap):
 *   labelFromMonacoId(monacoId, question?, explicitLabel?) -> string
 *   fenceFromLabelOrId(labelOrId) -> 'python'|'cpp'|...|'text'
 *   normalizeFence(fence, label) -> string
 *   normalizeFenceFromLabel(label) -> string
 *   KNOWN -> map
 */
(function(NS){
  'use strict';
  if (!NS || !NS.defineNS) return;
  var UTIL = NS.defineNS('util');
  var existing = UTIL.langmap || UTIL.lang;
  if (existing && existing.__ready__) return;

  var KNOWN = {
    python:{label:'Python',fence:'python',aliases:['python3','py']},
    cpp:{label:'C++',fence:'cpp',aliases:['c++']},
    c:{label:'C',fence:'c'},
    java:{label:'Java',fence:'java'},
    javascript:{label:'JavaScript',fence:'javascript',aliases:['js']},
    typescript:{label:'TypeScript',fence:'typescript',aliases:['ts']},
    csharp:{label:'C#',fence:'csharp',aliases:['cs','c#']},
    go:{label:'Go',fence:'go',aliases:['golang']},
    kotlin:{label:'Kotlin',fence:'kotlin'},
    swift:{label:'Swift',fence:'swift'},
    php:{label:'PHP',fence:'php'},
    ruby:{label:'Ruby',fence:'ruby'},
    rust:{label:'Rust',fence:'rust'},
    scala:{label:'Scala',fence:'scala'},
    r:{label:'R',fence:'r'},
    sql:{label:'SQL',fence:'sql'},
    bash:{label:'bash',fence:'bash',aliases:['sh','shell']},
    text:{label:'Text',fence:'text'}
  };

  function labelFromMonacoId(monacoId, q, explicit){
    if (explicit && typeof explicit === 'string' && explicit.trim()) return explicit.trim();
    var id = (String(monacoId || '').toLowerCase());
    if (id === 'python'){
      var hasPy3 = q && Array.isArray(q.codeSnippets) && q.codeSnippets.some(function(s){ return String(s.langSlug||'').toLowerCase() === 'python3'; });
      return hasPy3 ? 'Python3' : 'Python';
    }
    if (!id) return 'Text';
    if (KNOWN[id]) return KNOWN[id].label;
    var k, info;
    for (k in KNOWN){ info = KNOWN[k]; if (info.aliases && info.aliases.indexOf(id) !== -1) return info.label; }
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  function fenceFromLabelOrId(s){
    if (!s) return 'text';
    var id = String(s).toLowerCase();
    if (id === 'python3') return 'python';
    if (KNOWN[id]) return KNOWN[id].fence;
    var k, info;
    for (k in KNOWN){ info = KNOWN[k]; if (info.aliases && info.aliases.indexOf(id) !== -1) return info.fence; }
    return 'text';
  }
  function normalizeFence(fence, label){
    if (/^python/i.test(String(label||''))) return 'python';
    return fence || 'text';
  }
  function normalizeFenceFromLabel(label){ return normalizeFence(fenceFromLabelOrId(label), label); }

  var API = {
    __ready__: true,
    KNOWN: KNOWN,
    labelFromMonacoId: labelFromMonacoId,
    fenceFromLabelOrId: fenceFromLabelOrId,
    normalizeFence: normalizeFence,
    normalizeFenceFromLabel: normalizeFenceFromLabel
  };

  UTIL.langmap = API;
  UTIL.lang = API; // legacy alias
})(window.LCMD);
