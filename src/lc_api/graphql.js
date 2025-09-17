/* src/lc_api/graphql.js
 * Thin GraphQL client + high-level LeetCode queries.
 * - Handles CSRF, multiple /graphql endpoints, JSON parsing, and schema drift.
 * - Provides convenience functions used by the pipeline.
 *
 * Public API (LCMD.lc.gql):
 *   gqlCall(query, variables?, opts?)
 *   fetchQuestion(titleSlug) -> { ...question, statsObj, similar, meta }
 *   fetchHints(titleSlug) -> string[]
 *   fetchSubmissionsForSlug(slug, opts?) -> [{id, statusDisplay, lang, timestamp}]
 *   fetchSubmissionDetails(id) -> { code, lang, runtimeStr, memoryStr, runtimeMs, memoryMB, runtimeBeats, memoryBeats, note }
 *   fetchBeatsViaCheck(id, {tries?}) -> { runtimeBeats, memoryBeats, runtimeStr, memoryStr, runtimeMs, memoryMB }
 *   mergeDetail(primary, fallback)
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var LC = NS.defineNS('lc');
  var LEGACY = NS.defineNS('lc_api');
  var existing = LC.gql || LC.graphql || LEGACY.graphql;
  if (existing && existing.__ready__) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;
  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  /* ----------------------------- utils ----------------------------- */
  function getCookie(name) {
    try {
      var parts = String(document.cookie || '').split('; ');
      for (var i=0;i<parts.length;i++) {
        var kv = parts[i].split('=');
        if (kv[0] === name) return kv[1] || '';
      }
    } catch (_){}
    return '';
  }
  function nonEmpty(s){ return typeof s === 'string' && s.trim().length > 0; }
  function coerceNum(x){
    if (x == null) return null;
    if (typeof x === 'number') return isFinite(x) ? x : null;
    var n = parseFloat(String(x).replace(/[^\d.\-+eE]/g,''));
    return isFinite(n) ? n : null;
  }
  function parseRuntimeMs(x){
    if (x==null) return null;
    if (typeof x==='number') return isFinite(x)?x:null;
    var s=String(x).trim();
    var m=s.match(/([-+]?\d*\.?\d+)\s*(ms|s)?/i);
    if(!m) return null;
    var v=parseFloat(m[1]); var u=(m[2]||'ms').toLowerCase();
    if (!isFinite(v)) return null;
    return (u==='s') ? v*1000 : v;
  }
  function parseMemoryMB(x){
    if (x==null) return null;
    if (typeof x==='number') return isFinite(x)?x:null;
    var s=String(x).trim();
    var m=s.match(/([-+]?\d*\.?\d+)\s*(kb|mb|gb|b)?/i);
    if(!m) return null;
    var v=parseFloat(m[1]); var u=(m[2]||'mb').toLowerCase();
    if (!isFinite(v)) return null;
    if (u==='b')  return v/1024/1024;
    if (u==='kb') return v/1024;
    if (u==='gb') return v*1024;
    return v;
  }

  function getGraphQLEnds(){
    var base = location.origin || '';
    return [base + '/graphql', base + '/graphql/'];
  }

  function withTimeout(promise, ms){
    if (!ms || ms <= 0) return promise;
    return new Promise(function(resolve, reject){
      var to = setTimeout(function(){ reject(new Error('timeout '+ms+'ms')); }, ms);
      promise.then(function(v){ clearTimeout(to); resolve(v); }, function(e){ clearTimeout(to); reject(e); });
    });
  }

  /* ----------------------------- core GQL ----------------------------- */
  /**
   * @param {string} query
   * @param {object=} variables
   * @param {{timeoutMs?:number, headers?:object}=} opts
   */
  async function gqlCall(query, variables, opts){
    var cfg = getCfg();
    var timeout = (opts && opts.timeoutMs) || ((cfg.api && cfg.api.timeoutMs) || 12000);
    var csrftoken = getCookie('csrftoken') || getCookie('csrftoken_v2') || '';

    var eps = getGraphQLEnds();
    var lastErr = null;

    for (var i=0;i<eps.length;i++){
      var ep = eps[i];
      try {
        var res = await withTimeout(fetch(ep, {
          method: 'POST',
          credentials: 'include',
          headers: Object.assign({
            'content-type': 'application/json',
            'x-csrftoken': csrftoken
          }, (opts && opts.headers) || {}),
          body: JSON.stringify({ query: query, variables: variables || {} })
        }), timeout);

        var text = await res.text();
        if (!res.ok) throw new Error('HTTP '+res.status+' at '+ep+' — '+text.slice(0, 200));
        var obj;
        try { obj = JSON.parse(text); } catch (_){ throw new Error('Non-JSON GraphQL: '+text.slice(0,200)); }
        if (obj.errors && obj.errors.length) {
          var msg = obj.errors.map(function(e){ return e && (e.message || JSON.stringify(e)); }).join(' | ');
          throw new Error('GraphQL error(s): ' + msg);
        }
        return obj;
      } catch (e) {
        lastErr = e;
        log.debug('gqlCall: endpoint failed', ep, e && (e.message || e));
      }
    }
    throw lastErr || new Error('GraphQL call failed across endpoints.');
  }

  /* ----------------------------- high level ----------------------------- */

  async function fetchQuestion(slug){
    log.debug('fetchQuestion', slug);
    var variants = [
      "query q($titleSlug:String!){question(titleSlug:$titleSlug){questionId title titleSlug content difficulty stats exampleTestcases sampleTestCase metaData codeSnippets{lang langSlug code} topicTags{name slug} similarQuestions}}",
      "query q($titleSlug:String!){question(titleSlug:$titleSlug){questionId title titleSlug content difficulty stats exampleTestcases metaData codeSnippets{lang langSlug code} topicTags{name slug} similarQuestions}}",
      "query q($titleSlug:String!){question(titleSlug:$titleSlug){questionId title titleSlug content difficulty stats codeSnippets{lang langSlug code} topicTags{name slug} similarQuestions}}"
    ];
    var d = null, lastErr = null;
    for (var i=0;i<variants.length;i++){
      try {
        var out = await gqlCall(variants[i], { titleSlug: slug });
        d = (out && out.data && out.data.question) || null;
        if (d) break;
      } catch (e) {
        lastErr = e;
        log.debug('fetchQuestion: variant failed', e && (e.message || e));
      }
    }
    if (!d) throw lastErr || new Error('fetchQuestion: no data');

    var statsObj = {};
    var similar = [];
    var meta = {};
    try { statsObj = JSON.parse(d.stats || '{}') || {}; } catch (_){}
    try { similar  = JSON.parse(d.similarQuestions || '[]') || []; } catch (_){}
    try { meta     = JSON.parse(d.metaData || '{}') || {}; } catch (_){}

    return Object.assign({}, d, { statsObj: statsObj, similar: similar, meta: meta });
  }

  async function fetchHints(slug){
    log.debug('fetchHints', slug);
    var variants = [
      "query h($titleSlug:String!){ question(titleSlug:$titleSlug){ hints } }",
      "query h($titleSlug:String!){ question(titleSlug:$titleSlug){ hintList } }",
      "query h($titleSlug:String!){ question(titleSlug:$titleSlug){ hintsWithId { id hint } } }"
    ];
    for (var i=0;i<variants.length;i++){
      try {
        var out = await gqlCall(variants[i], { titleSlug: slug });
        var q = out && out.data && out.data.question;
        if (!q) continue;
        if (Array.isArray(q.hints) && q.hints.length)      return q.hints.map(String);
        if (Array.isArray(q.hintList) && q.hintList.length) return q.hintList.map(String);
        if (Array.isArray(q.hintsWithId) && q.hintsWithId.length) return q.hintsWithId.map(function(x){ return String((x && x.hint) || ''); });
      } catch (e) {
        log.debug('fetchHints: variant failed', e && (e.message || e));
      }
    }
    return [];
  }

  /**
   * @param {string} slug
   * @param {{limit?:number,pageSize?:number}=} opts
   */
  async function fetchSubmissionsForSlug(slug, opts){
    var cfg = getCfg();
    var MAX = (opts && opts.limit) || ((cfg.pipeline && cfg.pipeline.maxSubmissions) || 60);
    var PAGE = (opts && opts.pageSize) || ((cfg.pipeline && cfg.pipeline.pageSize) || 20);

    var collected = [];
    var offset = 0;
    var useNoLang = false;
    var keep = true;

    var qPrimary = "query s($offset:Int!,$limit:Int!,$questionSlug:String!){submissionList(offset:$offset, limit:$limit, questionSlug:$questionSlug){submissions{ id statusDisplay lang timestamp } hasNext lastKey }}";
    var qNoLang  = "query s($offset:Int!,$limit:Int!,$questionSlug:String!){submissionList(offset:$offset, limit:$limit, questionSlug:$questionSlug){submissions{ id statusDisplay timestamp } hasNext lastKey }}";

    while (keep && collected.length < MAX){
      var limit = Math.min(PAGE, MAX - collected.length);
      var resp;
      try {
        resp = await gqlCall(useNoLang ? qNoLang : qPrimary, { offset: offset, limit: limit, questionSlug: slug });
      } catch (e) {
        if (!useNoLang) {
          log.debug('fetchSubmissions: primary failed; retry without lang', e && (e.message || e));
          useNoLang = true;
          resp = await gqlCall(qNoLang, { offset: offset, limit: limit, questionSlug: slug });
        } else {
          throw e;
        }
      }
      var block = resp && resp.data && resp.data.submissionList;
      var subs = (block && block.submissions) || [];
      for (var i=0;i<subs.length;i++){
        var s = subs[i];
        collected.push({
          id: Number(s.id),
          statusDisplay: s.statusDisplay || '',
          timestamp: s.timestamp || null,
          lang: (typeof s.lang === 'string' ? s.lang : '')
        });
      }
      if (!(block && block.hasNext) || subs.length === 0) keep = false;
      offset += subs.length;
    }
    return collected;
  }

  async function fetchSubmissionDetails(id){
    var fieldsVariants = [
      'id code runtime memory runtimeDisplay memoryDisplay runtimePercentile memoryPercentile lang { name } notes',
      'id code runtime memory runtimePercentile memoryPercentile lang { name } notes',
      'id code runtimePercentile memoryPercentile notes',
      'id code runtime memory runtimePercentile memoryPercentile',
      'id code'
    ];
    for (var i=0;i<fieldsVariants.length;i++){
      try {
        var q = "query d($id:Int!){ submissionDetails(submissionId:$id){ " + fieldsVariants[i] + " } }";
        var out = await gqlCall(q, { id: id });
        var d = out && out.data && out.data.submissionDetails;
        if (d) {
          var runtimeStr = (d.runtimeDisplay != null ? d.runtimeDisplay : d.runtime) || null;
          var memoryStr  = (d.memoryDisplay  != null ? d.memoryDisplay  : d.memory)  || null;
          var rp = coerceNum(d.runtimePercentile);
          var mp = coerceNum(d.memoryPercentile);
          var note = typeof d.notes === 'string' ? d.notes : '';

          return {
            source: 'graphql',
            code: typeof d.code === 'string' ? d.code : '',
            lang: (d.lang && d.lang.name) || null,
            runtimeStr: runtimeStr,
            memoryStr: memoryStr,
            runtimeMs: parseRuntimeMs(runtimeStr),
            memoryMB: parseMemoryMB(memoryStr),
            runtimeBeats: rp,
            memoryBeats: mp,
            note: note
          };
        }
      } catch (e) {
        log.debug('fetchSubmissionDetails: fields variant failed', fieldsVariants[i], e && (e.message || e));
      }
    }
    return {};
  }

  /**
   * REST fallback for runtime/memory/percentiles if GraphQL omitted them.
   * (Lives here for convenience—even though it’s not GraphQL.)
   */
  async function fetchBeatsViaCheck(id, opts){
    var tries = (opts && opts.tries) || 7;
    var delay = 350;
    var url = (location.origin || '') + '/submissions/detail/' + id + '/check/';
    for (var i=0;i<tries;i++){
      try {
        var res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP '+res.status);
        var j = await res.json();
        var state = j.state || j.stateCode || '';
        var rtp = coerceNum(j.runtime_percentile != null ? j.runtime_percentile : j.runtimePercentile);
        var memp = coerceNum(j.memory_percentile  != null ? j.memory_percentile  : j.memoryPercentile);
        var rtStr = j.status_runtime || j.runtimeDisplay || '';
        var memStr= j.status_memory  || j.memoryDisplay  || '';
        var rtMs  = parseRuntimeMs(rtStr);
        var memMB = parseMemoryMB(memStr);

        if (state && /success|finished|done/i.test(String(state))) {
          return { source:'rest', runtimeBeats: rtp, memoryBeats: memp, runtimeStr: rtStr, memoryStr: memStr, runtimeMs: rtMs, memoryMB: memMB };
        }
        if (rtp != null || memp != null || rtMs != null || memMB != null) {
          return { source:'rest', runtimeBeats: rtp, memoryBeats: memp, runtimeStr: rtStr, memoryStr: memStr, runtimeMs: rtMs, memoryMB: memMB };
        }
      } catch (e) {
        log.debug('fetchBeatsViaCheck: try failed', e && (e.message || e));
      }
      await new Promise(function(r){ setTimeout(r, delay); });
      delay = Math.min(1800, Math.round(delay * 1.5));
    }
    return {};
  }

  function mergeDetail(primary, fallback){
    var out = {};
    var k; for (k in primary) if (Object.prototype.hasOwnProperty.call(primary,k)) out[k] = primary[k];
    var fields = ['runtimeBeats','memoryBeats','runtimeStr','memoryStr','runtimeMs','memoryMB'];
    for (var i=0;i<fields.length;i++){
      var f = fields[i];
      if (out[f] == null && fallback && fallback[f] != null) out[f] = fallback[f];
    }
    return out;
  }

  /* ----------------------------- export ----------------------------- */
  var API = {
    __ready__: true,
    gqlCall: gqlCall,
    fetchQuestion: fetchQuestion,
    fetchHints: fetchHints,
    fetchSubmissionsForSlug: fetchSubmissionsForSlug,
    fetchSubmissionDetails: fetchSubmissionDetails,
    fetchBeatsViaCheck: fetchBeatsViaCheck,
    mergeDetail: mergeDetail,
    queryQuestion: fetchQuestion,
    queryHints: fetchHints,
    querySubmissionList: fetchSubmissionsForSlug,
    querySubmissionDetails: fetchSubmissionDetails,
    // utils (optional export)
    _utils: {
      getGraphQLEnds: getGraphQLEnds,
      parseRuntimeMs: parseRuntimeMs,
      parseMemoryMB: parseMemoryMB,
      coerceNum: coerceNum
    }
  };

  LC.gql = API;
  LC.graphql = API; // alias
  LEGACY.graphql = API; // legacy namespace

})(window.LCMD);
