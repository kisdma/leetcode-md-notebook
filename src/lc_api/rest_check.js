/* src/lc_api/rest_check.js
 * Lightweight client for LeetCode's REST submission check endpoint:
 *   GET /submissions/detail/{id}/check/
 *
 * Use-cases:
 *  - Fill in runtime/memory and "beats %" when GraphQL omits them.
 *  - Poll until the judge finishes (bounded retries with backoff).
 *
 * Public API (LCMD.lc.rest):
 *   fetchCheckRaw(id, opts?) -> Promise<{ ok, json?, status?, error? }>
 *   parseCheck(json) -> { runtimeBeats?, memoryBeats?, runtimeStr?, memoryStr?, runtimeMs?, memoryMB?, state?, raw? }
 *   pollCheck(id, opts?) -> Promise<{ source:'rest', runtimeBeats?, memoryBeats?, runtimeStr?, memoryStr?, runtimeMs?, memoryMB?, state? }>
 *
 * Options:
 *   fetchCheckRaw(id, { timeoutMs? })
 *   pollCheck(id, { tries?:number=7, initialDelayMs?:number=350, backoff?:number=1.5, maxDelayMs?:number=1800, timeoutMs?:number })
 *
 * Notes:
 *   - Credentials are included (browser session) and the call is same-origin.
 *   - Idempotent: safe to @require multiple times.
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var LC = NS.defineNS('lc');
  var LEGACY = NS.defineNS('lc_api');
  var existing = LC.rest || LEGACY.rest_check;
  if (existing && existing.__ready__) return;

  var root;
  try { root = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (_) { root = window; }

  var log    = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };
  var cfgAPI = NS.core && NS.core.configAPI;
  function getCfg() { return cfgAPI ? cfgAPI.get() : ((NS.core && NS.core.config) || {}); }

  /* ---------------- utils ---------------- */
  function withTimeout(promise, ms){
    if (!ms || ms <= 0) return promise;
    return new Promise(function(resolve, reject){
      var to = setTimeout(function(){ reject(new Error('timeout '+ms+'ms')); }, ms);
      promise.then(function(v){ clearTimeout(to); resolve(v); }, function(e){ clearTimeout(to); reject(e); });
    });
  }
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
  function isDoneState(state, statusMsg){
    var s = (state || '').toString().toLowerCase();
    if (/success|finished|done|accepted/.test(s)) return true;
    // Sometimes state can be empty but status_msg reflects finality
    var m = (statusMsg || '').toString().toLowerCase();
    if (/accepted|wrong answer|time limit|memory limit|compile error|runtime error/.test(m)) return true;
    return false;
  }

  /* ---------------- core calls ---------------- */
  /**
   * Fetch raw JSON from /submissions/detail/{id}/check/
   * @param {number|string} id
   * @param {{timeoutMs?:number}=} opts
   * @returns {Promise<{ok:boolean, json?:object, status?:number, error?:string}>}
   */
  async function fetchCheckRaw(id, opts){
    var cfg = getCfg();
    var timeout = (opts && opts.timeoutMs) || ((cfg.api && cfg.api.timeoutMs) || 12000);
    var url = (location.origin || '') + '/submissions/detail/' + id + '/check/';
    try {
      var res = await withTimeout(fetch(url, { credentials: 'include' }), timeout);
      var status = res.status;
      var json = null;
      try { json = await res.json(); } catch (e) {
        // Some responses might be text; attempt to coerce
        try { var t = await res.text(); json = JSON.parse(t); } catch (_) {}
      }
      if (!res.ok) return { ok:false, status: status, error: 'HTTP '+status, json: json || undefined };
      return { ok:true, status: status, json: json || {} };
    } catch (e) {
      return { ok:false, error: (e && (e.message || e)) || 'network', status: undefined };
    }
  }

  /**
   * Normalize the /check/ JSON payload into metrics we care about.
   * @param {object} j
   * @returns {{runtimeBeats?:number, memoryBeats?:number, runtimeStr?:string, memoryStr?:string, runtimeMs?:number, memoryMB?:number, state?:string, raw?:object}}
   */
  function parseCheck(j){
    if (!j || typeof j !== 'object') return {};
    var state = j.state || j.stateCode || '';
    var statusMsg = j.status_msg || j.statusMsg || '';

    // Percentiles sometimes appear under different keys
    var rtp = coerceNum(j.runtime_percentile != null ? j.runtime_percentile : j.runtimePercentile);
    var memp = coerceNum(j.memory_percentile  != null ? j.memory_percentile  : j.memoryPercentile);

    // Human strings
    var rtStr = j.status_runtime || j.runtimeDisplay || j.total_runtime || '';
    var memStr= j.status_memory  || j.memoryDisplay  || j.total_memory  || '';

    // Parsed numeric values
    var rtMs  = parseRuntimeMs(rtStr);
    var memMB = parseMemoryMB(memStr);

    var out = {
      runtimeBeats: rtp != null ? rtp : undefined,
      memoryBeats:  memp != null ? memp : undefined,
      runtimeStr: rtStr || undefined,
      memoryStr: memStr || undefined,
      runtimeMs: rtMs != null ? rtMs : undefined,
      memoryMB: memMB != null ? memMB : undefined,
      state: state || undefined,
      raw: j
    };

    // If neither beats nor parsed numbers exist, return minimal
    return out;
  }

  /**
   * Poll the /check/ endpoint until finished or useful numbers appear.
   * @param {number|string} id
   * @param {{tries?:number, initialDelayMs?:number, backoff?:number, maxDelayMs?:number, timeoutMs?:number}=} opts
   * @returns {Promise<{source:'rest', runtimeBeats?, memoryBeats?, runtimeStr?, memoryStr?, runtimeMs?, memoryMB?, state?}>}
   */
  async function pollCheck(id, opts){
    var tries = (opts && opts.tries) || 7;
    var delay = (opts && opts.initialDelayMs) || 350;
    var backoff= (opts && opts.backoff) || 1.5;
    var maxD  = (opts && opts.maxDelayMs) || 1800;
    var timeoutMs = (opts && opts.timeoutMs);

    var lastMetrics = null;

    for (var i=0;i<tries;i++){
      var res = await fetchCheckRaw(id, { timeoutMs: timeoutMs });
      if (res.ok && res.json) {
        var parsed = parseCheck(res.json);
        lastMetrics = parsed;

        if (isDoneState(parsed.state, res.json.status_msg)) {
          return Object.assign({ source:'rest' }, parsed);
        }
        // Accept early if we already have any meaningful numbers
        if (parsed.runtimeBeats != null || parsed.memoryBeats != null ||
            parsed.runtimeMs != null   || parsed.memoryMB != null) {
          return Object.assign({ source:'rest' }, parsed);
        }
      } else {
        log.debug('rest_check: fetch failed try='+(i+1)+' err='+(res && res.error));
      }

      // wait with backoff
      await new Promise(function(r){ setTimeout(r, delay); });
      delay = Math.min(maxD, Math.round(delay * backoff));
    }

    // Fallback to last seen metrics (may be partial/undefined)
    return Object.assign({ source:'rest' }, lastMetrics || {});
  }

  /* ---------------- export ---------------- */
  var API = {
    __ready__: true,
    fetchCheckRaw: fetchCheckRaw,
    parseCheck: parseCheck,
    pollCheck: pollCheck,
    checkSubmission: function(id, opts){ return pollCheck(id, opts); }
  };

  LC.rest = API;
  LC.rest_check = API; // alias
  LEGACY.rest_check = API;

})(window.LCMD);
