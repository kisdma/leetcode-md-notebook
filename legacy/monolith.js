// ==UserScript==
// @name         LeetCode → Full Markdown & Jupyter Notebook (fast popup glossary)
// @namespace    https://tampermonkey.net/
// @version      4.0.0
// @description  Copies a polished Markdown report (images, hints, glossary, submissions) and exports a .ipynb with a shared test harness + optional reference; popups start immediately after clicking.
// @match        https://leetcode.com/problems/*
// @match        https://leetcode.com/contest/*/problems/*
// @match        https://leetcode.cn/problems/*
// @match        https://leetcode.cn/contest/*/problems/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ----------------------------- Global Guard (SPA-safe) ----------------------------- */
  try {
    if (unsafeWindow && unsafeWindow.__LC_MD_INSTALLED__) return;
    if (unsafeWindow) unsafeWindow.__LC_MD_INSTALLED__ = true;
  } catch (_) {
    if (window.__LC_MD_INSTALLED__) return;
    window.__LC_MD_INSTALLED__ = true;
  }

  /*****************************************************************
   * A. NetworkTap — capture BOTH custom input and typed_code/lang
   *****************************************************************/
  function installNetworkTap(cb){
    const code = `(function(){
      if (window.__LC_NET_TAP_V2__) return; window.__LC_NET_TAP_V2__ = true;
      const F = window.fetch;
      function pickFields(text){
        const out = { customInput:'', typedCode:'', lang:'' };
        try{
          if (!text) return out;
          const parseKV = (kv) => {
            const v = kv || {};
            const vars = v.variables || v;
            out.customInput = vars.input || vars.testCase || vars.testcase || vars.data_input || vars.customInput || out.customInput;
            out.typedCode   = vars.typed_code || vars.code || out.typedCode;
            out.lang        = vars.lang || vars.language || vars.langSlug || out.lang;
          };
          if (text.startsWith('{')){
            const j = JSON.parse(text);
            parseKV(j);
          } else {
            const p = new URLSearchParams(text);
            out.customInput = p.get('input') || p.get('testCase') || p.get('testcase') || p.get('data_input') || p.get('customInput') || out.customInput;
            out.typedCode   = p.get('typed_code') || p.get('code') || out.typedCode;
            out.lang        = p.get('lang') || p.get('language') || p.get('langSlug') || out.lang;
          }
        } catch {}
        return out;
      }
      window.fetch = async function(input, init){
        try{
          const url = (typeof input === 'string') ? input : input.url;
          const method = (init?.method || input?.method || 'GET').toUpperCase();
          const path = new URL(url, location.href).pathname;
          const isInteresting = (/(submissions|interpret|run|judge|execute|check|runcase|submit)/i.test(url) && method === 'POST') || (/\\/graphql\\/?$/.test(path) && method === 'POST');
          if (isInteresting){
            let body = '';
            if (typeof init?.body === 'string') body = init.body;
            else if (init?.body instanceof URLSearchParams) body = init.body.toString();
            else if (init?.body instanceof FormData){ const o={}; for (const [k,v] of init.body) o[k]=v; body = JSON.stringify(o); }
            else if (input && input.bodyUsed === false && input.clone){ try { body = await input.clone().text(); } catch{} }
            const picked = pickFields(body);
            window.dispatchEvent(new CustomEvent('lc-input-v2', { detail: picked }));
          }
        }catch(e){}
        return F.apply(this, arguments);
      };
    })();`;
    const s = document.createElement('script'); s.textContent = code; document.documentElement.appendChild(s); s.remove();
    window.addEventListener('lc-input-v2', ev => { try{ cb(ev.detail || { customInput:'', typedCode:'', lang:'' }); }catch{} });
  }

  /*****************************************************************
   * B/C. Monaco dump (top + frames)
   *****************************************************************/
  function installMonacoDumpTop(){
    const code = `(function(){
      if (window.__LC_MONACO_DUMP_TOP__) return; window.__LC_MONACO_DUMP_TOP__ = true;
      function isVis(node){ try{ if(!node) return false; const r=node.getBoundingClientRect(); return r.width>0 && r.height>0 && document.contains(node); }catch(e){ return false; } }
      function pickEditor(M){
        const eds = (M && M.editor && M.editor.getEditors) ? M.editor.getEditors() : [];
        const focused = eds.find(e => e && e.hasTextFocus && e.hasTextFocus());
        if (focused) return focused;
        const visible = eds.find(e => isVis(e && e.getDomNode && e.getDomNode()));
        if (visible) return visible;
        return eds[0] || null;
      }
      window.addEventListener('lc-monaco-request-top', function(){
        try{
          const M = window.monaco;
          let code='', langId='', info={ where:'top' };
          if (M && M.editor){
            const eds = M.editor.getEditors ? M.editor.getEditors() : [];
            const models = M.editor.getModels ? M.editor.getModels() : [];
            const focused = eds.find(e => e && e.hasTextFocus && e.hasTextFocus());
            const visible = eds.find(e => isVis(e && e.getDomNode && e.getDomNode()));
            const ed = pickEditor(M);
            let model = ed && ed.getModel ? ed.getModel() : null;
            if (!model && models && models.length){
              model = models.sort((a,b)=>((b.getValue?b.getValue().length:0)-(a.getValue?a.getValue().length:0)))[0] || null;
            }
            if (model){
              code = (model.getValue && model.getValue()) || '';
              langId = (model.getLanguageId && model.getLanguageId()) || '';
            }
            info = { where:'top', editors: eds.length, models: models.length, focused: !!focused, visible: !!visible, chose: focused?'focused':(visible?'visible':(eds[0]?'first':'none')), modelLen: (code||'').length, langId };
          }
          document.dispatchEvent(new CustomEvent('lc-monaco-dump-top', { detail: { code, langId, __info: info } }));
        }catch(e){
          document.dispatchEvent(new CustomEvent('lc-monaco-dump-top', { detail: { code:'', langId:'', __info:{ where:'top', error: String(e && e.message || e) } } }));
        }
      });
    })();`;
    const s = document.createElement('script'); s.textContent = code; document.documentElement.appendChild(s); s.remove();
  }
  installMonacoDumpTop();
  function requestMonacoDumpTop(timeout=1200){
    return new Promise(resolve=>{
      const on = (ev)=>{ document.removeEventListener('lc-monaco-dump-top', on); resolve(ev.detail||{code:'', langId:'', __info:{} }); };
      document.addEventListener('lc-monaco-dump-top', on, { once:true });
      document.dispatchEvent(new Event('lc-monaco-request-top'));
      setTimeout(()=>{ try{ document.removeEventListener('lc-monaco-dump-top', on);}catch{} resolve({code:'',langId:'', __info:{ where:'top', timeout:true }}); }, timeout);
    });
  }

  let FRAME_SEQ = 0;
  function injectDumpIntoFrame(frameWin, frameDoc){
    const code = `(function(){
      if (window.__LC_MONACO_DUMP_FRAME__) return; window.__LC_MONACO_DUMP_FRAME__ = true;
      function isVis(node){ try{ if(!node) return false; const r=node.getBoundingClientRect(); return r.width>0 && r.height>0 && document.contains(node); }catch(e){ return false; } }
      function pickEditor(M){
        const eds = (M && M.editor && M.editor.getEditors) ? M.editor.getEditors() : [];
        const focused = eds.find(e => e && e.hasTextFocus && e.hasTextFocus());
        if (focused) return focused;
        const visible = eds.find(e => isVis(e && e.getDomNode && e.getDomNode()));
        if (visible) return visible;
        return eds[0] || null;
      }
      window.addEventListener('message', function(ev){
        try{
          const msg = ev && ev.data;
          if (!msg || msg.type !== 'lc-monaco-request') return;
          const reqId = msg.id || '';
          const M = window.monaco;
          let code='', langId='', info={ where:'frame' };
          if (M && M.editor){
            const eds = M.editor.getEditors ? M.editor.getEditors() : [];
            const models = M.editor.getModels ? M.editor.getModels() : [];
            const focused = eds.find(e => e && e.hasTextFocus && e.hasTextFocus());
            const visible = eds.find(e => isVis(e && e.getDomNode && e.getDomNode()));
            const ed = pickEditor(M);
            let model = ed && ed.getModel ? ed.getModel() : null;
            if (!model && models && models.length){
              model = models.sort((a,b)=>((b.getValue?b.getValue().length:0)-(a.getValue?a.getValue().length:0)))[0] || null;
            }
            if (model){
              code = (model.getValue && model.getValue()) || '';
              langId = (model.getLanguageId && model.getLanguageId()) || '';
            }
            info = { where:'frame', editors: eds.length, models: models.length, focused: !!focused, visible: !!visible, chose: focused?'focused':(visible?'visible':(eds[0]?'first':'none')), modelLen: (code||'').length, langId };
          } else {
            info = { where:'frame', monaco:false };
          }
          window.parent.postMessage({ type:'lc-monaco-dump', id: reqId, data: { code, langId, __info: info } }, '*');
        }catch(e){
          window.parent.postMessage({ type:'lc-monaco-dump', id: (ev && ev.data && ev.data.id) || '', data: { code:'', langId:'', __info: { where:'frame', error: String(e && e.message || e) } } }, '*');
        }
      });
    })();`;
    const s = frameDoc.createElement('script'); s.textContent = code; frameDoc.documentElement.appendChild(s); s.remove();
    try{ frameWin.__LC_MONACO_DUMP_FRAME_INJECTED__ = true; }catch{}
  }
  function isSameOriginFrame(frame){ try{ void frame.contentDocument; return true; }catch{ return false; } }
  function listSameOriginFrames(){
    const ifr = Array.from(document.querySelectorAll('iframe'));
    const out=[]; for (const f of ifr){ if (isSameOriginFrame(f)){ out.push({ el:f, win:f.contentWindow, doc:f.contentDocument }); } }
    return out;
  }
  async function requestMonacoFromFrames(timeoutPer=1200){
    const frames = listSameOriginFrames();
    if (frames.length===0) return { code:'', langId:'', __info:{ where:'frames', count:0 } };
    const id = 'fr_'+(++FRAME_SEQ)+'_'+Math.random().toString(36).slice(2,8);
    let settled=false, timer=null, first=null;
    function cleanup(){ window.removeEventListener('message', onMsg); if (timer) clearTimeout(timer); }
    function onMsg(ev){
      const data = ev && ev.data;
      if (!data || data.type!=='lc-monaco-dump' || data.id!==id) return;
      if (!settled && data.data){
        const payload = data.data;
        if (!first) first = payload;
        if (payload.code && payload.code.trim()){
          settled = true; cleanup(); resolve(payload);
        }
      }
    }
    const p = new Promise(resolve=>{
      window.addEventListener('message', onMsg);
      for (const fr of frames){ try{ if (!fr.win.__LC_MONACO_DUMP_FRAME_INJECTED__){ injectDumpIntoFrame(fr.win, fr.doc); } fr.win.postMessage({ type:'lc-monaco-request', id }, '*'); } catch{} }
      timer = setTimeout(()=>{ cleanup(); resolve(first || { code:'', langId:'', __info:{ where:'frames', timeout:true } }); }, timeoutPer + 200);
    });
    return p;
  }

  /*****************************************************************
   * D. Storage for captured inputs & typed_code (per slug)
   *****************************************************************/
  const STORE_KEY = 'lc_capture_store_v2';
  function loadStore(){ try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } }
  function saveStore(obj){ try { sessionStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch {} }
  function getSlugFromPath(){
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'problems') return parts[1];
    const i = parts.indexOf('problems'); return (i !== -1 && parts[i+1]) ? parts[i+1] : null;
  }
  function updateStore(fn){ const o = loadStore(); const r = fn(o) || o; saveStore(r); }
  function setCustomInput(slug, custom){ if (!slug || !custom || !custom.trim()) return; updateStore(o => { o[slug] = o[slug] || {}; o[slug].custom = { value: custom, when: Date.now() }; return o; }); }
  function setTypedCode(slug, code, lang){ if (!slug || !code || !code.trim()) return; updateStore(o => { o[slug] = o[slug] || {}; o[slug].typed = { value: code, lang: lang || '', when: Date.now() }; return o; }); }
  function getCustomInput(slug){ const o=loadStore()[slug]||{}; return o.custom?.value || ''; }
  function getTypedCode(slug){ const o=loadStore()[slug]||{}; return o.typed || null; }

  installNetworkTap(({ customInput, typedCode, lang }) => {
    const slug = getSlugFromPath();
    if (customInput && customInput.trim()){
      setCustomInput(slug, customInput);
      if (captureBadge) updateCaptureBadge();
      console.log('[LC→MD] Custom input captured', { slug, lines: customInput.split('\n').length });
    }
    if (typedCode && typedCode.trim()){
      setTypedCode(slug, typedCode, lang || '');
      console.log('[LC→MD] typed_code captured', { slug, len: typedCode.length, lang });
    }
  });

  /*****************************************************************
   * E. Config & UI
   *****************************************************************/
  const MAX_SUBMISSIONS       = 60;
  const PAGE_SIZE             = 20;
  const BETWEEN_DETAIL_MS     = 160;
  const INCLUDE_LANG_IN_MD    = true;
  const CLIP_NOTES_CHARS      = 180;
  const WAIT_MONACO_MS        = 9000;

  const CODE_BLOCK_COLLAPSE   = false;

  const INLINE_IMAGES         = true;
  const IMAGE_TIMEOUT_MS      = 20000;

  const MONACO_TRACE          = true;
  const STORAGE_TRACE         = true;
  const FALLBACK_TRACE        = true;
  const IFRAMES_TRACE         = true;
// Popup content readiness config
const CONTENT_READY = {
  MIN_CHARS: 40,          // require at least this many non-whitespace chars
  STABLE_SAMPLES: 3,      // need same HTML this many checks in a row
  STABLE_GAP_MS: 80,      // gap between stability checks
  TIMEOUT_MS: 1200,        // max time to wait for content after popup opens
  SEMANTIC_SEL: 'p, ul, ol, li, pre, code, table, strong, em, h1,h2,h3,h4,h5,h6'
};


  // Live glossary popup capture config (short waits + capped open timeout)
  const GLOSSARY_CFG = {
    HOVER_CLICK_WAIT_MS: 80,
    CLOSE_WAIT_MS: 80,
    PROXIMITY_PX: 500,
    MAX_TERMS: 50,
    OPEN_TIMEOUT_MS: 500
  };
  const GLOSSARY_VERBOSE_LOG = true;

  let btnReport, btnLog, btnSaveNB, toast, captureBadge, busy=false;

  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true }); else fn(); }
  onReady(() => {
    ensureBar();
    const mo = new MutationObserver(() => { if (!document.body.contains(btnReport)) ensureBar(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  });

  function ensureBar(){
    if (btnReport && document.body.contains(btnReport)) return;
    const bar = document.createElement('div');
    Object.assign(bar.style, { position:'fixed', right:'16px', bottom:'16px', zIndex:999999, display:'flex', gap:'8px', alignItems:'center' });

    toast = document.createElement('div');
    Object.assign(toast.style, { position:'fixed', right:'16px', bottom:'64px', zIndex:999999, padding:'10px 14px', borderRadius:'10px', border:'1px solid #ccc', background:'#f9f9f9', fontSize:'12px', whiteSpace:'pre-line', maxWidth:'560px', display:'none' });

    btnReport = makeBtn('Copy Report');
    btnLog    = makeBtn('Copy Log');
    btnSaveNB = makeBtn('Save .ipynb');

    captureBadge = document.createElement('span');
    Object.assign(captureBadge.style, { fontSize:'12px', padding:'4px 8px', borderRadius:'999px', border:'1px solid #ccc', background:'#fff', color:'#555' });
    captureBadge.textContent = 'Custom run: not captured yet';
    updateCaptureBadge();

    bar.appendChild(btnReport); bar.appendChild(btnSaveNB); bar.appendChild(btnLog); bar.appendChild(captureBadge);
    document.body.appendChild(bar); document.body.appendChild(toast);

    btnReport.addEventListener('click', onCopyReport);
    btnLog.addEventListener('click', onCopyLog);
    btnSaveNB.addEventListener('click', onSaveNotebook);
    console.log('[LC→MD] Ready: buttons injected.');
  }
  (function patchHistory(){
    const push = history.pushState, repl = history.replaceState;
    function fire(){ window.dispatchEvent(new Event('locationchange')); }
    history.pushState = function(){ const r = push.apply(this, arguments); fire(); return r; };
    history.replaceState = function(){ const r = repl.apply(this, arguments); fire(); return r; };
    window.addEventListener('popstate', () => fire());
    window.addEventListener('locationchange', () => updateCaptureBadge());
  })();
  function makeBtn(label){ const b=document.createElement('button'); b.textContent=label; Object.assign(b.style,{ padding:'10px 12px', borderRadius:'10px', border:'1px solid #ccc', background:'#fff', fontWeight:600, cursor:'pointer', boxShadow:'0 2px 10px rgba(0,0,0,0.15)' }); return b; }
  function showToast(msg){ toast.textContent=msg; toast.style.display='block'; clearTimeout(showToast._t); showToast._t=setTimeout(()=> (toast.style.display='none'),6000); }
  function updateCaptureBadge(){
    if (!captureBadge) return;
    const slug = getSlugFromPath();
    const val = getCustomInput(slug);
    if (val && val.trim()){
      captureBadge.textContent = 'Custom run: captured ✅';
      Object.assign(captureBadge.style, { borderColor:'#16a34a', color:'#166534', background:'#dcfce7' });
    } else {
      captureBadge.textContent = 'Custom run: not captured yet';
      Object.assign(captureBadge.style, { borderColor:'#ccc', color:'#555', background:'#fff' });
    }
  }

  /*****************************************************************
   * F. Logging helpers & utils
   *****************************************************************/
  let LOG_ENABLED=false, LOG_LINES=null;
  function log(line){ console.log('[LC→MD] ' + line); if (LOG_ENABLED && LOG_LINES) LOG_LINES.push(line); }
  function logG(){ if (!GLOSSARY_VERBOSE_LOG) return; const msg=[...arguments].map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' '); log('[glossary] ' + msg); }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fmtPct = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(2) : (x ?? ''));
  const clip = (s, n=120) => (s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''));
  const nonEmpty = (s) => (typeof s === 'string' && s.trim().length > 0);
  const toLocalStringFromEpochSec = (sec) => { try { return sec ? new Date(sec * 1000).toLocaleString() : ''; } catch { return ''; } };
  function getCookie(name){ return document.cookie.split('; ').map(v=>v.split('=')).find(([k])=>k===name)?.[1] || ''; }
  function makeAbsoluteUrl(u){ try { return new URL(u, location.href).href; } catch { return u; } }
  function coerceNum(x){ if (x == null) return null; const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[^\d.\-+eE]/g,'')); return isFinite(n) ? n : null; }
  function j(obj){ try{return JSON.stringify(obj);}catch{return String(obj);} }
  function parseRuntimeMs(x){ if (x==null) return null; if (typeof x==='number') return isFinite(x)?x:null; const s=String(x).trim(); const m=s.match(/([-+]?\d*\.?\d+)\s*(ms|s)?/i); if(!m) return null; const v=parseFloat(m[1]); const u=(m[2]||'ms').toLowerCase(); return !isFinite(v)?null:(u==='s'?v*1000:v); }
  function parseMemoryMB(x){ if (x==null) return null; if (typeof x==='number') return isFinite(x)?x:null; const s=String(x).trim(); const m=s.match(/([-+]?\d*\.?\d+)\s*(kb|mb|gb|b)?/i); if(!m) return null; const v=parseFloat(m[1]); const u=(m[2]||'mb').toLowerCase(); if(!isFinite(v)) return null; if(u==='b') return v/1024/1024; if(u==='kb') return v/1024; if(u==='gb') return v*1024; return v; }
  function blobToDataURL(blob){ return new Promise((resolve,reject)=>{ const fr=new FileReader(); fr.onload=()=>resolve(fr.result); fr.onerror=reject; fr.readAsDataURL(blob); }); }
  function sanitizeCodeForMarkdown(code) { if (!nonEmpty(code)) return code || ''; return String(code).replace(/(^|\n)```+/g, (m, p1) => `${p1}# \`\`\``); }
  function commentOutsideFences(input, { commentPrefix = '# ' } = {}) {
    const text = String(input || '').replace(/\r\n/g, '\n');
    const fenceCount = (text.match(/^\s*(```|~~~)/gm) || []).length;
    if (fenceCount < 2) return text;
    const lines = text.split('\n'); const out = []; let inside = false; const fenceRe = /^\s*(```|~~~)/;
    for (const ln of lines) { if (fenceRe.test(ln)) { out.push((commentPrefix + ln).trimEnd()); inside = !inside; } else if (inside) { out.push(ln); } else { out.push(ln.trim().length ? (commentPrefix + ln) : commentPrefix.trim()); } }
    return out.join('\n');
  }

  /*****************************************************************
   * G. GraphQL plumbing
   *****************************************************************/
  function getGraphQLEnds(){ return [`${location.origin}/graphql`, `${location.origin}/graphql/`]; }
  async function gqlCall(query, variables){
    const csrftoken = getCookie('csrftoken') || getCookie('csrftoken_v2') || '';
    const eps = getGraphQLEnds(); let lastErr;
    for (const ep of eps){
      try{
        const res = await fetch(ep, { method:'POST', credentials:'include', headers:{ 'content-type':'application/json', 'x-csrftoken': csrftoken }, body: JSON.stringify({ query, variables })});
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} at ${ep} — ${text.slice(0,200)}`);
        let obj; try { obj = JSON.parse(text); } catch { throw new Error(`Non-JSON GraphQL: ${text.slice(0,200)}`); }
        if (obj.errors?.length){ const msg = obj.errors.map(e=>e.message||JSON.stringify(e)).join(' | '); throw new Error(`GraphQL error(s): ${msg}`); }
        return obj;
      } catch(e){ lastErr = e; }
    }
    throw lastErr || new Error('GraphQL call failed across endpoints.');
  }

  async function fetchQuestion(slug){
    log(`Q: fetching question meta for "${slug}"`);
    const variants = [
`query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId title titleSlug content difficulty stats exampleTestcases sampleTestCase metaData codeSnippets { lang langSlug code } topicTags { name slug } similarQuestions } }`,
`query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId title titleSlug content difficulty stats exampleTestcases metaData codeSnippets { lang langSlug code } topicTags { name slug } similarQuestions } }`,
`query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId title titleSlug content difficulty stats codeSnippets { lang langSlug code } topicTags { name slug } similarQuestions } }`
    ];
    let d=null, lastErr=null;
    for (const q of variants){
      try { const out = await gqlCall(q, { titleSlug: slug }); d = out?.data?.question || {}; break; }
      catch(e){ lastErr=e; log('Q: variant failed — ' + (e?.message||e)); }
    }
    if (!d) throw lastErr || new Error('Failed to fetch question data');
    let statsObj = {}; try { statsObj = JSON.parse(d.stats || '{}'); } catch {}
    let similar = []; try { similar = JSON.parse(d.similarQuestions || '[]'); } catch {}
    let meta = {};   try { meta   = JSON.parse(d.metaData || '{}'); } catch {}
    return { ...d, statsObj, similar, meta };
  }

  async function fetchHints(slug){
    const variants = [
`query qHints($titleSlug:String!){ question(titleSlug:$titleSlug){ hints } }`,
`query qHints($titleSlug:String!){ question(titleSlug:$titleSlug){ hintList } }`,
`query qHints($titleSlug:String!){ question(titleSlug:$titleSlug){ hintsWithId { id hint } } }`
    ];
    for (const q of variants){
      try{
        const out = await gqlCall(q, { titleSlug: slug });
        const dq = out?.data?.question || {};
        if (Array.isArray(dq.hints) && dq.hints.length) return dq.hints.map(String);
        if (Array.isArray(dq.hintList) && dq.hintList.length) return dq.hintList.map(String);
        if (Array.isArray(dq.hintsWithId) && dq.hintsWithId.length) return dq.hintsWithId.map(x => String(x.hint || ''));
      }catch(e){ log('Hints: variant failed — ' + (e?.message||e)); }
    }
    return [];
  }

  async function fetchSubmissionsForSlug(slug){
    log(`Fetch: submissions for "${slug}"`);
    const collected = []; let offset=0; let useNoLang=false; let keep=true;
    const qPrimary = `query submissionList($offset:Int!, $limit:Int!, $questionSlug:String!) { submissionList(offset:$offset, limit:$limit, questionSlug:$questionSlug) { submissions { id statusDisplay lang timestamp } hasNext lastKey }}`;
    const qNoLang = `query submissionList($offset:Int!, $limit:Int!, $questionSlug:String!) { submissionList(offset:$offset, limit:$limit, questionSlug:$questionSlug) { submissions { id statusDisplay timestamp } hasNext lastKey }}`;
    while (keep && collected.length < MAX_SUBMISSIONS){
      const limit = Math.min(PAGE_SIZE, MAX_SUBMISSIONS - collected.length);
      let resp;
      try { resp = await gqlCall(useNoLang ? qNoLang : qPrimary, { offset, limit, questionSlug: slug }); }
      catch(e){ if (!useNoLang){ log('Fetch: primary failed; retry without lang. ' + (e?.message||e)); useNoLang=true; resp = await gqlCall(qNoLang, { offset, limit, questionSlug: slug }); } else { throw e; } }
      const block = resp?.data?.submissionList; const subs = block?.submissions || [];
      log(`Fetch: got ${subs.length} submissions (offset ${offset}).`);
      for (const s of subs) collected.push({ id:Number(s.id), statusDisplay:s.statusDisplay||'', timestamp:s.timestamp||null, lang: (typeof s.lang === 'string' ? s.lang : '') });
      if (!block?.hasNext || subs.length===0) keep=false;
      offset += subs.length;
    }
    log(`Fetch: total collected ${collected.length}`);
    return collected;
  }

  async function fetchSubmissionDetailsGraphQL(id){
    const variants = [
      'id code runtime memory runtimeDisplay memoryDisplay runtimePercentile memoryPercentile lang { name } notes',
      'id code runtime memory runtimePercentile memoryPercentile lang { name } notes',
      'id code runtimePercentile memoryPercentile notes',
      'id code runtime memory runtimePercentile memoryPercentile',
      'id code'
    ];
    for (const fields of variants){
      try{
        const q = `query submissionDetails($id:Int!) { submissionDetails(submissionId:$id) { ${fields} } }`;
        const out = await gqlCall(q, { id });
        const d = out?.data?.submissionDetails;
        if (d){
          const runtimeStr = d.runtimeDisplay ?? d.runtime ?? null;
          const memoryStr  = d.memoryDisplay  ?? d.memory  ?? null;
          const rp = coerceNum(d.runtimePercentile);
          const mp = coerceNum(d.memoryPercentile);
          const note = typeof d.notes === 'string' ? d.notes : '';
          return {
            source: 'graphql',
            code: typeof d.code === 'string' ? d.code : '',
            lang: d.lang?.name ?? null,
            runtimeStr, memoryStr,
            runtimeMs: parseRuntimeMs(runtimeStr),
            memoryMB: parseMemoryMB(memoryStr),
            runtimeBeats: rp, memoryBeats: mp,
            note
          };
        }
      }catch(e){ log(`Details ${id}: fields "${fields}" failed — ${e?.message||e}`); }
    }
    return {};
  }

  async function fetchBeatsViaCheck(id, { tries = 7 } = {}){
    const url = `${location.origin}/submissions/detail/${id}/check/`;
    let delay = 350;
    for (let i=0;i<tries;i++){
      try{
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP '+res.status);
        const j = await res.json();
        const state = j.state || j.stateCode || '';
        const rtp = coerceNum(j.runtime_percentile ?? j.runtimePercentile);
        const memp = coerceNum(j.memory_percentile  ?? j.memoryPercentile);
        const rtStr = j.status_runtime || j.runtimeDisplay || '';
        const memStr= j.status_memory  || j.memoryDisplay  || '';
        const rtMs  = parseRuntimeMs(rtStr);
        const memMB = parseMemoryMB(memStr);
        if (FALLBACK_TRACE) log(`Check fallback ${id}: state=${state} rt='${rtStr}' (${rtMs} ms) mem='${memStr}' (${memMB} MB) rb=${fmtPct(rtp)} mb=${fmtPct(memp)}`);
        if (state && /success|finished|done/i.test(String(state))){
          return { source:'rest', runtimeBeats: rtp, memoryBeats: memp, runtimeStr: rtStr, memoryStr: memStr, runtimeMs: rtMs, memoryMB: memMB };
        }
        if (rtp != null || memp != null || rtMs != null || memMB != null){
          return { source:'rest', runtimeBeats: rtp, memoryBeats: memp, runtimeStr: rtStr, memoryStr: memStr, runtimeMs: rtMs, memoryMB: memMB };
        }
      } catch(e){ log(`Check fallback ${id}: ${e?.message||e}`); }
      await sleep(delay);
      delay = Math.min(1800, Math.round(delay * 1.5));
    }
    return {};
  }
  function mergeDetail(primary, fallback){
    const out = Object.assign({}, primary);
    for (const k of ['runtimeBeats','memoryBeats','runtimeStr','memoryStr','runtimeMs','memoryMB']){
      if (out[k]==null && fallback && fallback[k]!=null) out[k]=fallback[k];
    }
    return out;
  }

  /*****************************************************************
   * H. Editor detection & localStorage heuristic
   *****************************************************************/
  async function waitForMonacoOnPage(ms = WAIT_MONACO_MS){
    const t0=Date.now(); let lastLen=0, lastReport=0;
    log(`Monaco: wait start (timeout=${ms}ms). monaco=${!!window.monaco}`);
    while (Date.now()-t0 < ms){
      const mon = window.monaco;
      if (mon?.editor){
        const models = mon.editor.getModels?.() || [];
        const editors= mon.editor.getEditors?.() || [];
        const anyVisible = editors.some(e => {
          try{ const n=e.getDomNode?.(); if(!n) return false; const r=n.getBoundingClientRect(); return r.width>0 && r.height>0; }catch{return false;}
        });
        const curLen = models.reduce((a,m)=>a+((m.getValue?.()||'').length),0);
        if (MONACO_TRACE && Date.now()-lastReport>350){
          log(`Monaco: poll editors=${editors.length}, models=${models.length}, anyVisible=${anyVisible}, totalBufLen=${curLen}`);
          lastReport = Date.now();
        }
        if ((editors.length && anyVisible) || models.length){
          if (curLen>0 && (lastLen===0 || Math.abs(curLen-lastLen)>0)){ log('Monaco: ready — non-empty buffers detected.'); return true; }
          lastLen = curLen;
        }
      }
      await sleep(120);
    }
    log('Monaco: wait timed out.');
    return false;
  }

  function visibleLangLabel(){
    const sels=['[data-cy="lang-select"] .ant-select-selection-item','.ant-select-selector .ant-select-selection-item','button[aria-label*="Language"]','div[role="combobox"]'];
    for (const sel of sels){ const el=document.querySelector(sel); const t=el?.textContent?.trim(); if (nonEmpty(t)) return t; }
    const txt=(document.querySelector('[class*="editor"]')||document.body)?.textContent||'';
    const known=['Python3','Python','C++','Java','JavaScript','TypeScript','C#','Go','Kotlin','Swift','PHP','Ruby','Rust','Scala']; for (const k of known) if (txt.includes(k)) return k;
    return null;
  }
  const LANG_MAP = {
    python:{label:'Python',fence:'python',aliases:['python3','py']}, cpp:{label:'C++',fence:'cpp',aliases:['c++']}, c:{label:'C',fence:'c'},
    java:{label:'Java',fence:'java'}, javascript:{label:'JavaScript',fence:'javascript',aliases:['js']}, typescript:{label:'TypeScript',fence:'typescript',aliases:['ts']},
    csharp:{label:'C#',fence:'csharp',aliases:['cs','c#']}, go:{label:'Go',fence:'go',aliases:['golang']}, kotlin:{label:'Kotlin',fence:'kotlin'},
    swift:{label:'Swift',fence:'swift'}, php:{label:'PHP',fence:'php'}, ruby:{label:'Ruby',fence:'ruby'}, rust:{label:'Rust',fence:'rust'},
    scala:{label:'Scala',fence:'scala'}, r:{label:'R',fence:'r'}, sql:{label:'SQL',fence:'sql'}, bash:{label:'bash',fence:'bash',aliases:['sh','shell']},
    text:{label:'Text',fence:'text'},
  };
  function resolveLabel(monacoId, q, explicitLabel){
    if (nonEmpty(explicitLabel)) return explicitLabel.trim();
    if (monacoId==='python'){
      const hasPy3 = Array.isArray(q?.codeSnippets) && q.codeSnippets.some(s => (s.langSlug||'').toLowerCase()==='python3');
      return hasPy3 ? 'Python3' : 'Python';
    }
    if (!nonEmpty(monacoId)) return 'Text';
    const map = LANG_MAP[monacoId]; if (map) return map.label;
    for (const k of Object.keys(LANG_MAP)){ const info=LANG_MAP[k]; if (info.aliases?.includes?.(monacoId)) return info.label; }
    return monacoId.charAt(0).toUpperCase()+monacoId.slice(1);
  }
  function fenceFromLabelOrId(labelOrId){ if (!nonEmpty(labelOrId)) return 'text'; const s=labelOrId.toLowerCase(); if (s==='python3') return 'python'; if (LANG_MAP[s]) return LANG_MAP[s].fence; for (const k of Object.keys(LANG_MAP)){ const info=LANG_MAP[k]; if (info.aliases?.includes?.(s)) return info.fence; } return 'text'; }
  function normalizeFence(fence, label){ if (/^python/i.test(label||'')) return 'python'; return fence || 'text'; }
  function normalizeFenceFromLabel(label) { return normalizeFence(fenceFromLabelOrId(label), label); }

  async function grabMonacoOnlyCodeAndLang(q){
    log('Monaco-only: waiting for Monaco…');
    await waitForMonacoOnPage(WAIT_MONACO_MS);

    try{
      const dumpTop = await requestMonacoDumpTop(1200);
      if (MONACO_TRACE) log(`Monaco-only(top) info: ${j(dumpTop.__info)}`);
      if (nonEmpty(dumpTop.code)){
        const monacoId = (dumpTop.langId||'').toLowerCase();
        const visLabel = visibleLangLabel();
        const label = resolveLabel(monacoId, q, visLabel);
        const fence = normalizeFence(fenceFromLabelOrId(monacoId||visLabel||''), label);
        log(`Monaco-only: TOP OK — langId=${monacoId||'unknown'} label=${label} len=${dumpTop.code.length}`);
        return { code: dumpTop.code, fence, label, meta:{ source:'monaco-top', info: dumpTop.__info || {} } };
      }
    }catch(e){ log('Monaco-only: top failed: '+(e?.message||e)); }

    try{
      const frames = listSameOriginFrames();
      if (IFRAMES_TRACE) log(`Monaco-only: scanning iframes — total=${frames.length}`);
      if (frames.length){
        for (const fr of frames){ try{ if (!fr.win.__LC_MONACO_DUMP_FRAME_INJECTED__){ injectDumpIntoFrame(fr.win, fr.doc); } }catch{} }
        const dump = await requestMonacoFromFrames(1400);
        if (IFRAMES_TRACE) log(`Monaco-only(frames) info: ${j(dump.__info)}`);
        if (nonEmpty(dump.code)){
          const monacoId = (dump.langId||'').toLowerCase();
          const visLabel = visibleLangLabel();
          const label = resolveLabel(monacoId, q, visLabel);
          const fence = normalizeFence(fenceFromLabelOrId(monacoId||visLabel||''), label);
          log(`Monaco-only: FRAME OK — langId=${monacoId||'unknown'} label=${label} len=${dump.code.length}`);
          return { code: dump.code, fence, label, meta:{ source:'monaco-frame', info: dump.__info || {} } };
        }
      }
    }catch(e){ log('Monaco-only: frame path failed: '+(e?.message||e)); }

    try{
      const monaco = unsafeWindow && unsafeWindow.monaco;
      if (monaco?.editor?.getModels) {
        const models = monaco.editor.getModels();
        const best = models
          .map(m => ({ val: m.getValue ? m.getValue() : '', lang: m.getLanguageId ? m.getLanguageId() : '' }))
          .sort((a,b)=> (b.val?.length||0) - (a.val?.length||0))[0];
        if (best?.val){
          const monacoId=(best.lang||'').toLowerCase();
          const visLabel=visibleLangLabel();
          const label = resolveLabel(monacoId, q, visLabel);
          const fence = normalizeFence(fenceFromLabelOrId(monacoId||visLabel||''), label);
          log(`Monaco-only: unsafeWindow OK — label=${label} len=${best.val.length}`);
          return { code: best.val, fence, label, meta:{ source:'monaco-unsafeWindow' } };
        }
      }
    }catch(e){ log('Monaco-only: unsafeWindow failed: '+(e?.message||e)); }

    return { code:'', fence:'text', label:'Text', meta:{ source:'monaco-none' } };
  }

  /* Heuristics for localStorage scan (unchanged, trimmed for brevity) */
  function looksLikeCode(s) {
    if (!s || typeof s !== 'string') return false;
    const hints = ['def ', 'class ', 'function ', '#include', 'public static', 'console.log', ';', '=>', 'var ', 'let ', 'const '];
    let score = 0; for (const h of hints) if (s.includes(h)) score++; if (s.split('\n').length >= 3) score++; return score >= 2 && s.length >= 40;
  }
  function isCodeLikelyForProblem(code, q) {
    if (!code || !q) return false;
    const hasSolutionClass = /\bclass\s+Solution\b/.test(code);
    const fn = (q?.meta && (q.meta.name || q.meta.functionName || q.meta.fun || q.meta.funcName)) || '';
    const hasFnName = fn ? new RegExp(`\\b${fn}\\b`).test(code) : false;
    let sniffed = '';
    if (!hasFnName && Array.isArray(q?.codeSnippets)) {
      for (const snip of q.codeSnippets) {
        const s = snip?.code || '';
        const mPy = s.match(/\bdef\s+([A-Za-z_]\w*)\s*\(/);
        if (mPy) { sniffed = mPy[1]; break; }
        const mGen = s.match(/\b([A-Za-z_]\w*)\s*\(/);
        if (mGen && !['if','for','while','switch','return','class','function'].includes(mGen[1])) { sniffed = mGen[1]; break; }
      }
    }
    const hasSniffed = sniffed ? new RegExp(`\\b${sniffed}\\b`).test(code) : false;
    if (hasSolutionClass && (hasFnName || hasSniffed)) return true;
    if (!fn && hasSolutionClass) return true;
    return false;
  }
  function extractCodeStringsFromJsonVal(v, cap = 3) {
    const out = []; function walk(o, d) { if (d > cap) return; if (typeof o === 'string') { if (looksLikeCode(o)) out.push(o); return; } if (o && typeof o === 'object') { for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) try { walk(o[k], d + 1); } catch {} } }
    try { walk(v, 0); } catch {} return out;
  }
  function scanLocalStorageHeuristic(slug, q) {
    try {
      const ls = window.localStorage; if (!ls) return { ok: false, code: '', meta: { error: 'localStorage unavailable' } };
      const keys = []; try { for (let i = 0; i < ls.length; i++) keys.push(ls.key(i)); } catch { for (const k in ls) if (Object.prototype.hasOwnProperty.call(ls, k)) keys.push(k); }
      const lowerSlug = (slug || '').toLowerCase(); const bucketSlug = []; const bucketNeutral = [];
      for (const k of keys) {
        let val = null; try { val = ls.getItem(k); } catch {}
        if (!val) continue;
        let texts = []; try { texts = extractCodeStringsFromJsonVal(JSON.parse(val)); }
        catch { if (looksLikeCode(val)) texts = [val]; }
        for (const t of texts) {
          const cand = { key: k, text: t, matchSlug: k.toLowerCase().includes(lowerSlug), seemsForThis: isCodeLikelyForProblem(t, q) };
          (cand.matchSlug ? bucketSlug : bucketNeutral).push(cand);
        }
      }
      const pick = (arr) => arr.sort((a, b) => (b.seemsForThis === a.seemsForThis ? 0 : b.seemsForThis ? 1 : -1) || (b.text.length - a.text.length))[0];
      const chosen = pick(bucketSlug) || null;
      if (!chosen) return { ok: false, code: '', meta: { error: 'No localStorage code tied to this slug' } };
      if (!chosen.seemsForThis) return { ok: false, code: '', meta: { error: 'Slug key found but code looks unrelated', key: chosen.key } };
      return { ok: true, code: chosen.text, meta: { key: chosen.key, matchSlug: true, seemsForThis: true } };
    } catch (e) { return { ok: false, code: '', meta: { error: e && e.message || String(e) } }; }
  }

  /*****************************************************************
   * I. Image embedding helpers
   *****************************************************************/
  function gmXhrAvailable(){ return (typeof GM_xmlhttpRequest === 'function') || (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'); }
  function doGmXhr(opts){
    return new Promise((resolve, reject)=>{
      const fn = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest : (GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
      if (!fn){ reject(new Error('GM_xmlhttpRequest not available')); return; }
      fn(Object.assign({}, opts, { onload: resolve, onerror: e => reject(new Error(e && e.error || 'GM_xhr error')), ontimeout: () => reject(new Error('GM_xhr timeout')) }));
    });
  }
  function arrayBufferToBase64(ab){
    const bytes = new Uint8Array(ab); const chunk = 0x8000; let binary = '';
    for (let i=0; i<bytes.length; i+=chunk){ binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk)); }
    return btoa(binary);
  }
  async function fetchImageAsDataURL(url){
    if (gmXhrAvailable()){
      try{
        const res = await doGmXhr({ method: 'GET', url, timeout: IMAGE_TIMEOUT_MS, responseType: 'arraybuffer' });
        const headers = String(res.responseHeaders || ''); const ctMatch = headers.match(/^\s*content-type:\s*([^\r\n;]+)/im); const mime = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
        const ab = res.response; const size = ab ? ab.byteLength : 0; const b64 = size > 0 ? arrayBufferToBase64(ab) : '';
        if (b64) return { ok:true, dataUrl: `data:${mime};base64,${b64}`, mime, size };
      }catch(e){ /* fall through */ }
    }
    try{
      const r = await fetch(url, { credentials:'include' });
      if (!r.ok) throw new Error('HTTP '+r.status);
      const blob = await r.blob();
      const dataUrl = await blobToDataURL(blob);
      return { ok:true, dataUrl, mime: blob.type || 'application/octet-stream', size: blob.size || 0 };
    }catch(e){
      return { ok:false, error: e && e.message || 'fetch failed', dataUrl:'', mime:'', size:0 };
    }
  }

  /*****************************************************************
   * J. HTML→Markdown + robust Glossary capture (immediate popup support)
   *****************************************************************/
function isMeaningfulPopup(el) {
  if (!el) return false;
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length >= CONTENT_READY.MIN_CHARS) return true;
  if (el.querySelector(CONTENT_READY.SEMANTIC_SEL)) return true;
  // filter out obvious placeholders
  if (/loading|spinner|skeleton|please wait|正在加载/i.test(text)) return false;
  return text.length > 0;
}

async function waitForContentReady(container, opts = {}) {
  const cfg = { ...CONTENT_READY, ...opts };
  const t0 = performance.now();
  let lastHTML = '';
  let stable = 0;
  let timer = null;
  let done = false;
  let resolveFn;

  const mo = new MutationObserver(() => { /* changes wake the loop */ });
  try { mo.observe(container, { childList: true, subtree: true, characterData: true }); } catch {}

  function cleanup() {
    if (done) return;
    done = true;
    try { mo.disconnect(); } catch {}
    if (timer) clearTimeout(timer);
  }

  function step() {
    if (done) return;
    const now = performance.now();
    const html = container.innerHTML;
    const meaningful = isMeaningfulPopup(container);

    if (meaningful) {
      if (html === lastHTML) stable += 1; else stable = 1;
      lastHTML = html;
      if (stable >= cfg.STABLE_SAMPLES) { cleanup(); resolveFn(html); return; }
    }

    if (now - t0 >= cfg.TIMEOUT_MS) { cleanup(); resolveFn(container.innerHTML); return; }
    timer = setTimeout(step, cfg.STABLE_GAP_MS);
  }

  return new Promise(res => {
    resolveFn = res;
    // kick once now, then continue on a short cadence
    step();
  });
}
  function descriptionRoot() {
    return (
      document.querySelector('[data-cy="description-content"]') ||
      document.querySelector('[data-key="description-content"]') ||
      document.querySelector('section[aria-labelledby*="description"]') ||
      document.querySelector('[data-track-load*="description"]') ||
      null
    );
  }
  function isElVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function popupCandidates(){
    return Array.from(document.querySelectorAll([
      '[role="dialog"]','[role="tooltip"]','[data-radix-popper-content-wrapper]',
      '[data-portal] [role="dialog"]','[data-portal] [role="tooltip"]',
      '[data-portal] [data-state="open"]','[data-state="open"]'
    ].join(',')));
  }
  function nearestOpenPopup(button, radiusPx) {
    const vis = popupCandidates().filter(isElVisible);
    if (vis.length === 0) return null;
    const br = button.getBoundingClientRect();
    const bc = { x: br.left + br.width/2, y: br.top + br.height/2 };
    let best = null;
    for (const el of vis) {
      const r = el.getBoundingClientRect();
      const ec = { x: r.left + r.width/2, y: r.top + r.height/2 };
      const d = Math.hypot(bc.x - ec.x, bc.y - ec.y);
      if (d <= GLOSSARY_CFG.PROXIMITY_PX && (!best || d < best.d)) best = { el, d };
    }
    return best ? best.el : null;
  }
  async function waitForOpenPopup(btn, timeout=GLOSSARY_CFG.OPEN_TIMEOUT_MS){
    const t0 = performance.now();
    while (performance.now() - t0 < timeout){
      const id = btn.getAttribute('aria-controls');
      if (id) {
        const node = document.getElementById(id);
        if (node && isElVisible(node)) return node;
      }
      const near = nearestOpenPopup(btn, GLOSSARY_CFG.PROXIMITY_PX);
      if (near && isElVisible(near)) return near;
      await sleep(40);
    }
    return null;
  }
  async function closeAnyOpenGlossary(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', keyCode:27, which:27, bubbles:true }));
    await sleep(80);
  }
  function findDescriptionGlossaryButtons() {
    const root = descriptionRoot();
    if (!root) return [];
    const btns = Array.from(
      root.querySelectorAll('button[aria-haspopup="dialog"], button[aria-controls^="radix-"]')
    ).filter(b => (b.textContent || '').trim().length > 0);
    return btns.slice(0, GLOSSARY_CFG.MAX_TERMS);
  }
  function sanitizeAndGetPopupHTML(container) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll('button, [role="button"], [aria-label="Close"], [data-dismiss]').forEach(n => n.remove());
    return clone.innerHTML || '';
  }
  function popupHtmlToMarkdown(html) {
    const div = document.createElement('div');
    div.innerHTML = html;

    div.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      const lang = (code?.className || '').match(/language-([a-z0-9+-]+)/i)?.[1] || '';
      const content = (code ? code.textContent : pre.textContent) || '';
      const fence = '```';
      const md = `\n${fence}${lang ? (lang.startsWith('lang-') ? '' : lang) : ''}\n${content.replace(/\n$/, '')}\n${fence}\n`;
      pre.replaceWith(document.createTextNode(md));
    });
    div.querySelectorAll('code').forEach(code => {
      const t = code.textContent || '';
      code.replaceWith(document.createTextNode('`' + t.replace(/`/g, '\\`') + '`'));
    });
    div.querySelectorAll('strong, b').forEach(el => { const t=el.textContent||''; el.replaceWith(document.createTextNode('**'+t+'**')); });
    div.querySelectorAll('em, i').forEach(el => { const t=el.textContent||''; el.replaceWith(document.createTextNode('*'+t+'*')); });
    div.querySelectorAll('a[href]').forEach(a => {
      const text = (a.textContent || '').trim();
      const href = a.getAttribute('href') || '';
      a.replaceWith(document.createTextNode(`[${text}](${href})`));
    });
    div.querySelectorAll('ul, ol').forEach(list => {
      const isOL = list.tagName.toLowerCase() === 'ol';
      const items = Array.from(list.querySelectorAll(':scope > li'));
      const md = items.map((li, idx) => {
        const text = li.textContent || '';
        const bullet = isOL ? `${idx + 1}. ` : `- `;
        return bullet + text.replace(/\n/g, '\n  ');
      }).join('\n');
      list.replaceWith(document.createTextNode('\n' + md + '\n'));
    });
    for (let i=1;i<=6;i++){
      div.querySelectorAll('h'+i).forEach(h => { const t=h.textContent||''; h.replaceWith(document.createTextNode('\n**'+t.trim()+'**\n')); });
    }
    div.querySelectorAll('p, br').forEach(node => {
      if (node.tagName.toLowerCase()==='br') node.replaceWith(document.createTextNode('\n'));
      else { const t=node.textContent||''; node.replaceWith(document.createTextNode('\n'+t.trim()+'\n')); }
    });
    return (div.textContent || '').replace(/\n{3,}/g,'\n\n').trim();
  }
  function toFootnoteLabel(term) {
    let t = (term || '').trim();
    t = t.replace(/[\r\n]+/g, ' ').replace(/[\[\]]/g, '');
    if (!t) t = 'term';
    return t.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
  }
  function makeUniqueLabel(base, used) { let label = base || 'term'; let i = 2; while (used.has(label)) label = `${base}-${i++}`; used.add(label); return label; }
async function clickOpenAndGetPopupHTML(btn) {
  const term = (btn.textContent || '').trim();
  btn.scrollIntoView({ block: 'center', inline: 'center' });

  // make sure nothing else is open
  await closeAnyOpenGlossary();

  // small pre-hover helps some Radix/Headless UI popovers
  btn.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  btn.dispatchEvent(new MouseEvent('mousemove',   { bubbles: true }));

  // 1) Open
  btn.click();
  await sleep(GLOSSARY_CFG.HOVER_CLICK_WAIT_MS);

  // 2) Find container
  let container = await waitForOpenPopup(btn, GLOSSARY_CFG.OPEN_TIMEOUT_MS);
  let method = 'none';
  let html = '';

  if (container) {
    method = container.getAttribute('role') || container.id ? 'id/role' : 'near';
    // 3) Wait until content is meaningful & stable (fast exit if already ready)
    html = await waitForContentReady(container);
  }

  // 4) If still empty/weak, try exactly one re-open with a slightly longer budget
  const weak = !html || html.replace(/\s+/g, '').length < CONTENT_READY.MIN_CHARS;
  if (weak) {
    logG('retry-open', { term, reason: 'content not ready', htmlLen: (html||'').length });

    await closeAnyOpenGlossary();
    await sleep(40);
    btn.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mousemove',   { bubbles: true }));
    btn.click();
    await sleep(GLOSSARY_CFG.HOVER_CLICK_WAIT_MS);

    container = await waitForOpenPopup(btn, GLOSSARY_CFG.OPEN_TIMEOUT_MS * 2);
    if (container) {
      method = (method || '') + '+retry';
      html = await waitForContentReady(container, { TIMEOUT_MS: CONTENT_READY.TIMEOUT_MS * 1.5 });
    }
  }

  // 5) Close
  btn.click();
  await sleep(GLOSSARY_CFG.CLOSE_WAIT_MS);
  await closeAnyOpenGlossary();

  logG('capture', { term, method, got: (html||'').length });
  return { html: html || '', method };
}
  async function captureGlossaryFromLiveDescription() {
    const root = descriptionRoot();
    if (!root) { logG('no description root'); return []; }
    const buttons = findDescriptionGlossaryButtons();
    logG('found buttons', String(buttons.length));
    if (buttons.length === 0) return [];

    const used = new Set();
    const out = [];
    let idx = 0;
    for (const btn of buttons) {
      idx++;
      const term = (btn.textContent || '').trim();
      const { html, method } = await clickOpenAndGetPopupHTML(btn);
      const md = popupHtmlToMarkdown(html);
      const base = toFootnoteLabel(term);
      const label = makeUniqueLabel(base, used);
      out.push({ term, label, md, method, htmlLen: html.length, mdLen: md.length });
      logG('entry', { idx, term, label, method, mdLen: md.length });
    }
    return out;
  }

  async function htmlToMarkdownAdvanced(html, { inlineImages = INLINE_IMAGES, pairs: pairsIn } = {}){
    if (!nonEmpty(html)) return { md:'', imgStats:{ total:0, embedded:0, failed:0, details:[] }, footnotes:[] };
    const stats = { total:0, embedded:0, failed:0, details:[] };

    const container=document.createElement('div'); container.innerHTML=html;

    if (inlineImages){
      const imgs=[...container.querySelectorAll('img')];
      for (const img of imgs){
        try{
          stats.total++;
          const srcAttr = img.getAttribute('src') || img.getAttribute('data-src') || '';
          const abs=makeAbsoluteUrl(srcAttr); if (!abs) { stats.failed++; continue; }

          const r = await fetchImageAsDataURL(abs);
          if (r.ok && r.dataUrl){
            img.dataset.mdSrc = r.dataUrl;
            img.dataset.mdAlt = img.getAttribute('alt') || '';
            img.setAttribute('data-embed-ok','1');
            stats.embedded++;
            stats.details.push({ url: abs, embedded: true, size: r.size, mime: r.mime });
          } else {
            img.dataset.mdSrc = abs;
            const altOrig = img.getAttribute('alt') || '';
            img.dataset.mdAlt = (altOrig ? (altOrig + ' ') : '') + '⚠️ not embedded (remote)';
            img.setAttribute('data-embed-ok','0');
            stats.failed++;
            stats.details.push({ url: abs, embedded: false, reason: r.error || 'unknown' });
          }
        }catch(e){
          const srcAttr = img.getAttribute('src') || img.getAttribute('data-src') || '';
          const abs=makeAbsoluteUrl(srcAttr);
          img.dataset.mdSrc = abs;
          const altOrig = img.getAttribute('alt') || '';
          img.dataset.mdAlt = (altOrig ? (altOrig + ' ') : '') + '⚠️ not embedded (error)';
          img.setAttribute('data-embed-ok','0');
          stats.failed++;
          stats.details.push({ url: abs, embedded: false, reason: e && e.message || 'exception' });
        }
      }
    }

    // Preserve exponents/subscripts when extracting text, incl. inside <code>
    function textWithSupSub(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      if (tag === 'sup') { let inner = ''; for (const ch of node.childNodes) inner += textWithSupSub(ch); inner = inner.replace(/\s+/g, ''); return '^' + inner; }
      if (tag === 'sub') { let inner = ''; for (const ch of node.childNodes) inner += textWithSupSub(ch); inner = inner.replace(/\s+/g, ''); return '_' + inner; }
      let out = ''; for (const ch of node.childNodes) out += textWithSupSub(ch); return out;
    }

    // === Smart joiners to prevent squished inline boundaries ===
    function shouldPad(prev, next) {
      if (!prev || !next) return false;
      if (/^[,.;:!?)]/.test(next)) return false;
      if (/[([{\u201C\u2018]$/.test(prev)) return false;
      const wordlikeEnd   = /[A-Za-z0-9`\]\*_]$/;
      const wordlikeStart = /^[A-Za-z0-9`\[\*_]/;
      return wordlikeEnd.test(prev) && wordlikeStart.test(next);
    }
    function smartJoin(parts) {
      let out = '';
      for (const raw of parts) {
        const s = String(raw || '');
        if (!s) continue;
        const needSpace = out && !/\s$/.test(out) && !/^\s/.test(s) && shouldPad(out, s);
        out += (needSpace ? ' ' : '') + s;
      }
      return out;
    }

    async function nodeToMarkdown(node, depth){
      if (!node) return '';
      const type = node.nodeType;
      if (type === Node.TEXT_NODE) return (node.nodeValue || '').replace(/\s+/g,' ');
      if (type !== Node.ELEMENT_NODE) return '';
      const tag=node.tagName.toLowerCase();
      const getChildren = async () => { const parts = []; for (const ch of [...node.childNodes]) parts.push(await nodeToMarkdown(ch, depth)); return smartJoin(parts); };
      function onlySpecialKids(el){ const specials=new Set(['PRE','TABLE','BLOCKQUOTE','UL','OL','H1','H2','H3','H4','H5','H6','IMG']); const kids=[...el.childNodes].filter(n=>n.nodeType===Node.ELEMENT_NODE); if (!kids.length) return false; return kids.every(k=>specials.has(k.tagName)); }
      function tableToMarkdown(tbl){
        const rows=[...tbl.querySelectorAll('tr')]; if (!rows.length) return '';
        const headerCells=[...rows[0].children].map(c=>c.textContent.trim());
        const hasTH=rows[0].querySelectorAll('th').length>0;
        const headers=hasTH?headerCells:headerCells.map((_,i)=>`Col ${i+1}`);
        const md=[]; md.push(''); md.push('|'+headers.map(h=>' '+h+' ').join('|')+'|'); md.push('|'+headers.map(()=> '---').join('|')+'|');
        const startIdx=hasTH?1:0;
        for (let r=startIdx;r<rows.length;r++){ const cells=[...rows[r].children].map(c=>' '+c.textContent.trim()+' '); md.push('|'+cells.join('|')+'|'); }
        md.push(''); return md.join('\n');
      }
      switch(tag){
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': { const level=+tag[1]; const inner=(await getChildren()).trim(); return `\n${'#'.repeat(level)} ${inner}\n\n`; }
        case 'p': case 'section': case 'article': case 'div': { const specialOnly=onlySpecialKids(node); if (specialOnly) return await getChildren(); const inner=(await getChildren()).trim(); return inner ? `${inner}\n\n` : ''; }
        case 'strong': case 'b': { const inner = (await getChildren()).trim(); return inner ? `**${inner}**` : ''; }
        case 'em': case 'i': { const inner = (await getChildren()).trim(); return inner ? `*${inner}*` : ''; }
        case 'button': { const term  = (node.textContent || '').trim(); const inner = (await getChildren()).trim() || term; return inner; }
        case 'code': {
          if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') { const raw = textWithSupSub(node); return `\n\`\`\`\n${raw.trimEnd()}\n\`\`\`\n\n`; }
          const inner = textWithSupSub(node); return '`' + inner.replace(/`/g, '\\`') + '`';
        }
        case 'sup': { const inner = (await getChildren()).replace(/\s+/g, ''); return '^' + inner; }
        case 'sub': { const inner = (await getChildren()).replace(/\s+/g, ''); return '_' + inner; }
        case 'pre': { const codeEl=node.querySelector('code'); const raw=(codeEl?codeEl.textContent:node.textContent)||''; return `\n\`\`\`\n${raw.trimEnd()}\n\`\`\`\n\n`; }
        case 'ul': { let out='\n'; for (const li of [...node.children]){ if (li.tagName.toLowerCase()!=='li') continue; const content=(await nodeToMarkdown(li, depth+1)).trim(); const pad='  '.repeat(depth); out+=`${pad}- ${content}\n`; } return out+'\n'; }
        case 'ol': { let out='\n'; let idx=1; for (const li of [...node.children]){ if (li.tagName.toLowerCase()!=='li') continue; const content=(await nodeToMarkdown(li, depth+1)).trim(); const pad='  '.repeat(depth); out+=`${pad}${idx}. ${content}\n`; idx++; } return out+'\n'; }
        case 'li': { let parts=''; for (const ch of [...node.childNodes]) parts+=await nodeToMarkdown(ch, depth); return parts.replace(/\n{3,}/g,'\n\n').trim(); }
        case 'a': { const href=node.getAttribute('href')||''; const abs=makeAbsoluteUrl(href); const text=(await getChildren()).trim()||abs; return `[${text}](${abs})`; }
        case 'img': { const src=node.dataset.mdSrc||node.getAttribute('src')||''; const abs=makeAbsoluteUrl(src); const alt=node.dataset.mdAlt||node.getAttribute('alt')||''; return `![${alt}](${abs})`; }
        case 'blockquote': { const inner=(await getChildren()).trim(); return inner.split('\n').map(l=>`> ${l}`).join('\n')+'\n\n'; }
        case 'hr': return '\n---\n\n';
        case 'table': return tableToMarkdown(node)+'\n';
        default: return await getChildren();
      }
    }
    function injectGlossaryAnchorsIntoDesc(descMd, pairs) {
      if (!descMd || !pairs?.length) return descMd;
      const chunks = descMd.split(/(\n```[\s\S]*?\n```)/g);
      const used = new Set();
      function injectIntoText(text) {
        let out = text;
        for (const p of pairs) {
          if (used.has(p.label)) continue; if (!p.term || !p.md) continue;
          const safe = p.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const re = new RegExp(`\\b(${safe})\\b`);
          if (re.test(out)) { out = out.replace(re, `[${p.term}](#glossary-${p.label})`); used.add(p.label); logG('inject', { term: p.term, label: p.label }); }
          else { logG('inject-miss', { term: p.term }); }
        }
        return out;
      }
      for (let i = 0; i < chunks.length; i++) if (i % 2 === 0) chunks[i] = injectIntoText(chunks[i]);
      return chunks.join('');
    }
    async function nodeToMdRoot(){ const md=(await nodeToMarkdown(container,0)).trim().replace(/\n{3,}/g,'\n\n'); return md; }

    const mdRaw = await nodeToMdRoot();

    // Use pre-captured pairs if provided; otherwise capture now
    const pairs = Array.isArray(pairsIn) ? pairsIn : await captureGlossaryFromLiveDescription();
    log('[glossary] pairs captured: ' + (pairs?.length || 0));

    function buildGlossarySection(pairs) {
      if (!pairs || !pairs.length) return '';
      let md = '## Glossary\n\n';
      for (const p of pairs) {
        md += `<a id="glossary-${p.label}"></a>\n`;
        md += `**${p.term}**  \n`;
        md += `${p.md.replace(/\n/g, '  \n')}\n\n`;
      }
      return md;
    }

    const desc = injectGlossaryAnchorsIntoDesc(mdRaw, pairs);
    const outMd = (desc ? `## Description\n\n${desc}\n\n` : '') + buildGlossarySection(pairs);

    return { md: outMd, imgStats: stats, footnotes: [] };
  }

  /*****************************************************************
   * K. Vars & testcases
   *****************************************************************/
  function extractVarNamesFromMeta(q){
    const names=[]; const params=q?.meta?.params;
    if (Array.isArray(params)){ for (const p of params){ const nm=(p && (p.name||p.parameter||p.paramName)) || ''; if (nonEmpty(nm)) names.push(String(nm)); } }
    return names;
  }
  function extractVarNamesFromDescriptionText(q){
    try{
      const div=document.createElement('div'); div.innerHTML=q?.content||''; const text=div.textContent||''; const lines=text.split(/\r?\n/).map(s=>s.trim()); const names=[];
      for (const line of lines){
        if (/^input\s*:/i.test(line)){
          const rhs=line.replace(/^input\s*:/i,'').trim(); const tokens=rhs.split(/,/g);
          for (const tok of tokens){ const m=tok.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/); if (m){ const name=m[1]; if (!names.includes(name)) names.push(name); } }
        }
      }
      return names;
    }catch{ return []; }
  }
  function buildDefaultVarNamesGuess(blob){
    const lines = (blob || '').replace(/\r\n/g,'\n').split('\n');
    if (lines.length>=2 && /^-?\d+$/.test(lines[0].trim())){
      const T=parseInt(lines[0],10); const rem=lines.length-1;
      for (let V=1; V<=Math.min(6, rem); V++){ if (rem % V === 0 && rem / V === T) return Array.from({length:V},(_,i)=>`var${i+1}`); }
    }
    return ['var1'];
  }
  function getVariableNames(q, capturedBlob, defaultBlob){
    const fromMeta=extractVarNamesFromMeta(q); if (fromMeta.length) return fromMeta;
    const fromDesc=extractVarNamesFromDescriptionText(q); if (fromDesc.length) return fromDesc;
    const refBlob=capturedBlob||defaultBlob||''; return buildDefaultVarNamesGuess(refBlob);
  }
  function normalizeBlobToLines(blob){ if (!nonEmpty(blob)) return []; return String(blob).replace(/\r\n/g,'\n').split('\n'); }
  function isIntString(s){ return /^-?\d+$/.test(String(s).trim()); }
  function splitBlobIntoTestcases(blob, varNames){
    const lines=normalizeBlobToLines(blob); const V=Math.max(1,(varNames||[]).length||1); if (!lines.length) return { cases:[], usedLeadingCount:false };
    const trimmed=[...lines]; while (trimmed.length && trimmed[trimmed.length-1].trim()==='') trimmed.pop();
    if (trimmed.length>=1 && isIntString(trimmed[0])){ const T=parseInt(trimmed[0],10); const rem=trimmed.length-1;
      if (rem % V === 0 && rem / V === T){ const values=trimmed.slice(1); const cases=[]; for (let t=0;t<T;t++){ const off=t*V; const obj={}; for (let i=0;i<V;i++) obj[varNames[i]||`var${i+1}`]=values[off+i]??''; cases.push(obj); } return { cases, usedLeadingCount:true }; }
    }
    if (trimmed.length % V === 0){ const T=trimmed.length / V; const cases=[]; for (let t=0;t<T;t++){ const off=t*V; const obj={}; for (let i=0;i<V;i++) obj[varNames[i]||`var${i+1}`]=trimmed[off+i]??''; cases.push(obj);} return { cases, usedLeadingCount:false }; }
    const obj={}; for (let i=0;i<V;i++) obj[varNames[i]||`var${i+1}`]=trimmed[i]??''; return { cases:[obj], usedLeadingCount:false };
  }
  function renderTestcaseTable(title, blob, varNames){
    if (!nonEmpty(blob)) return `### ${title}\n\n*(none)*\n\n`;
    const { cases, usedLeadingCount } = splitBlobIntoTestcases(blob, varNames);
    const header = `### ${title}\n\n**Variables:** ${varNames.join(', ')}${usedLeadingCount ? '  \n*(first line treated as testcase count)*' : ''}\n\n`;
    const head = `| # | ${varNames.map(v=>`\`${v}\``).join(' | ')} |\n|:-:|${varNames.map(()=> '---').join('|')}|\n`;
    const rows = cases.map((c,i)=>`| ${i+1} | ${varNames.map(v => String(c[v] ?? '').replace(/\|/g,'\\|')).join(' | ')} |`).join('\n');
    const raw = `\n**Raw:**\n\n\`\`\`\n${blob}\n\`\`\`\n\n`;
    return header + head + rows + '\n' + raw;
  }

  /*****************************************************************
   * L. Markdown assembly
   *****************************************************************/
  function buildProblemHeader(q, solved){
    const id = q?.questionId ? String(q.questionId).trim() : '';
    const title=q?.title || q?.titleSlug || 'Unknown Title';
    const shownTitle = id ? `${id}. ${title}` : title;
    const diff=q?.difficulty || 'Unknown';
    const s=q?.statsObj || {}; const totalAcc=s.totalAccepted ?? s.totalAcceptedRaw ?? ''; const totalSubs=s.totalSubmission ?? s.totalSubmissionRaw ?? ''; const acRate = (typeof s.acRate === 'string' && s.acRate) ? s.acRate : '';
    const topics=(q?.topicTags||[]).map(t=>t.name).join(', ');
    const similar=(q?.similar||[]).map(sp=>{ const slug=sp.titleSlug||''; const link=slug?`https://leetcode.com/problems/${slug}/description/`:''; return `- ${sp.title} — ${sp.difficulty}${link?` — [link](${link})`:''}`; }).join('\n');
    const solvedStr = solved ? '✅ Solved' : '⬜ Not solved (in recent history)';
    let md = `# ${shownTitle}\n\n**Difficulty:** ${diff}  \n**Status:** ${solvedStr}\n\n**Stats:** Accepted: ${totalAcc} &nbsp;&nbsp; Submissions: ${totalSubs} &nbsp;&nbsp; Acceptance: ${acRate}\n\n`;
    if (topics) md += `**Topics:** ${topics}\n\n`;
    if (similar) md += `**Similar Problems:**\n${similar}\n\n`;
    return md;
  }

  async function buildDescriptionAndExamples(q, pairs){
    const { md: desc, imgStats } = await htmlToMarkdownAdvanced(q?.content||'', { inlineImages: INLINE_IMAGES, pairs });
    const exA=q?.exampleTestcases || '';
    const exB=q?.sampleTestCase || '';
    const defaultBlob=[exA,exB].filter(nonEmpty).join('\n').trim();

    let md = '';
    if (nonEmpty(desc)) {
      md += desc;
      if (imgStats.total > 0) {
        md += `> **Images:** embedded ${imgStats.embedded}/${imgStats.total}${imgStats.failed ? ` — ⚠️ ${imgStats.failed} not embedded (left as remote links)` : ''}\n\n`;
      }
    }
    if (nonEmpty(defaultBlob)) {
      md += `## Default Testcases (from problem)\n\n\`\`\`\n${defaultBlob}\n\`\`\`\n\n`;
    }
    return { md, defaultBlob };
  }

  function buildHintsSection(hints){
    if (!Array.isArray(hints) || hints.length === 0) return '';
    const lines = hints.map((h, i) => ` ${i+1}. ${String(h).replace(/\s+/g,' ').trim()}`).join('\n');
    return `## Hints\n\n${lines}\n\n`;
  }

  function buildTestcasesSection(title, varNames, defaultBlob, customBlob){
    let md = `## ${title}\n\n**Variables:** ${varNames.join(', ')}\n\n`;
    md += renderTestcaseTable('Default (from problem)', defaultBlob, varNames);
    if (nonEmpty(customBlob)) md += renderTestcaseTable('Custom (captured via NetworkTap)', customBlob, varNames);
    else md += `### Custom (captured via NetworkTap)\n\n*(none captured yet — click **Run**, then press **Copy Report** / **Save .ipynb** again)*\n\n`;
    return md;
  }

  function buildSubmissionsTable(slug, rows){
    const langHdr = INCLUDE_LANG_IN_MD ? ' | Lang' : '';
    const langSep = INCLUDE_LANG_IN_MD ? ' |:-----' : '';
    const header = `## Submissions — \`${slug}\`\n\n| # | ID | Status${langHdr} | Time | Runtime (ms) | Runtime Beats % | Memory (MB) | Memory Beats % | Notes |\n|:-:|---:|:------${langSep}|:-----|------------:|----------------:|-----------:|---------------:|:------|\n`;
    const lines = rows.map(r => {
      const timeStr=toLocalStringFromEpochSec(r.timestamp); const lang = INCLUDE_LANG_IN_MD ? ` | ${r.lang || ''}` : '';
      const rt = (/accepted/i.test(r.statusDisplay) && r.runtimeMs!=null) ? String(r.runtimeMs) : '';
      const rb = (/accepted/i.test(r.statusDisplay) && r.runtimeBeats!=null) ? fmtPct(r.runtimeBeats) : '';
      const mm = (/accepted/i.test(r.statusDisplay) && r.memoryMB!=null) ? String(r.memoryMB) : '';
      const mb = (/accepted/i.test(r.statusDisplay) && r.memoryBeats!=null) ? fmtPct(r.memoryBeats) : '';
      const note=clip((r.note||'').replace(/\n+/g,' '), CLIP_NOTES_CHARS);
      return `| ${r.idx} | ${r.id} | ${r.statusDisplay || ''}${lang} | ${timeStr} | ${rt} | ${rb} | ${mm} | ${mb} | ${note} |`;
    });
    return header + lines.join('\n') + '\n\n';
  }

  /*****************************************************************
   * M. Notebook builder
   *****************************************************************/
  function nbSkeleton(){
    return {
      "cells": [],
      "metadata": {
        "kernelspec": { "display_name": "Python 3", "language": "python", "name": "python3" },
        "language_info": { "name": "python", "version": "3.x" }
      },
      "nbformat": 4,
      "nbformat_minor": 5
    };
  }
  function mdCell(md){ return { cell_type:"markdown", metadata:{}, source: md.endsWith('\n')? md : md+'\n' }; }
  function pyCell(code){ return { cell_type:"code", metadata:{}, execution_count:null, outputs:[], source: code.endsWith('\n')? code : code+'\n' }; }
  function stringifyJson(x){ try { return JSON.stringify(x); } catch { return '[]'; } }

  function combineUniqueTestcases(varNames, defaultBlob, customBlob){
    const d = splitBlobIntoTestcases(defaultBlob, varNames).cases || [];
    const c = splitBlobIntoTestcases(customBlob, varNames).cases || [];
    const all = [...d, ...c];
    const uniq = [];
    const seen = new Set();
    for (const obj of all){
      const key = JSON.stringify(Object.fromEntries(Object.keys(obj).sort().map(k=>[k, String(obj[k]??'') ])));
      if (seen.has(key)) continue;
      seen.add(key); uniq.push(obj);
    }
    return uniq;
  }

  function buildHarnessCell(varNames, uniqCases){
    const PARAMS_JSON = stringifyJson(varNames);
    const CASES_JSON  = stringifyJson(uniqCases);
    const code = `# Common Test Harness (auto-generated)
import ast, json
from typing import List

_PARAM_ORDER = json.loads(${JSON.stringify(PARAMS_JSON)})
_UNIQ_CASES = json.loads(${JSON.stringify(CASES_JSON)})

def _coerce(s):
    if isinstance(s, (int, float, list, dict, bool, type(None))):
        return s
    if not isinstance(s, str): return s
    t = s.strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    try:
        return ast.literal_eval(t)
    except Exception:
        pass
    if ',' in t or ' ' in t:
        parts=[p for p in t.replace(',', ' ').split() if p]
        if parts and all(p.lstrip('-').isdigit() for p in parts):
            return [int(p) for p in parts]
        return parts
    return t

def _normalize(x):
    try:
        import numpy as _np
        if isinstance(x, _np.ndarray): x = x.tolist()
    except Exception:
        pass
    if isinstance(x, (list, tuple)):
        return [_normalize(v) for v in x]
    if isinstance(x, dict):
        return {k:_normalize(v) for k,v in x.items()}
    return x

def _pick_callable(cls):
    try:
        inst = cls()
    except Exception as e:
        print("Solution() not constructible:", e); return None, None
    for name in dir(inst):
        if name.startswith('_'): continue
        f = getattr(inst, name)
        if callable(f):
            return inst, f
    return inst, None

def _run_case_with(cls, args_dict):
    inst, fn = _pick_callable(cls)
    if fn is None:
        return {'error': 'no callable method'}
    kw = {}
    for k in _PARAM_ORDER:
        if k in args_dict:
            kw[k] = _coerce(args_dict[k])
    try:
        if kw:
            out = fn(**kw)
            args_repr = kw
        else:
            pos = [_coerce(args_dict[k]) for k in args_dict]
            out = fn(*pos)
            args_repr = pos
        return {'ok': True, 'out': _normalize(out), 'args': args_repr}
    except TypeError:
        pos = [_coerce(args_dict[k]) for k in _PARAM_ORDER if k in args_dict]
        try:
            out = fn(*pos)
            return {'ok': True, 'out': _normalize(out), 'args': pos}
        except Exception as e:
            return {'error': str(e)}
    except Exception as e:
        return {'error': str(e)}

def _get_reference_cls():
    return globals().get('ReferenceSolution', None)

def run_all_cases(SolutionClass):
    ref_cls = _get_reference_cls()
    passed = 0; total = len(_UNIQ_CASES)
    for i,case in enumerate(_UNIQ_CASES,1):
        print(f"Case {i}:")
        res = _run_case_with(SolutionClass, case)
        if 'error' in res:
            print("  ERROR:", res['error']); print("-"*60); continue
        print("  args:", res['args'])
        out = res['out']
        if ref_cls:
            exp = _run_case_with(ref_cls, case)
            if 'error' in exp:
                print("  REF ERROR:", exp['error'])
                print("  got:", out)
                print("-"*60); continue
            same = out == exp['out']
            print("  got:", out)
            print("  exp:", exp['out'])
            print("  ", "PASS" if same else "FAIL")
            if same: passed += 1
        else:
            print("  out:", out)
            passed += 1
        print("-"*60)
    if ref_cls:
        print(f"Summary: {passed}/{total} tests passed vs reference.")
    else:
        print(f"Summary: executed {total} tests (no reference available).")
`;
    return pyCell(code);
  }

  function buildReferenceCellIfAny(rows, detailsById){
    const acRows = rows.filter(r => /accepted/i.test(r.statusDisplay));
    if (!acRows.length) return null;
    const latest = acRows.reduce((a,b)=> ( (a.timestamp||0) >= (b.timestamp||0) ? a : b ));
    const det = detailsById[latest.id] || {};
    const lang = det.lang || latest.lang || '';
    const timeStr = toLocalStringFromEpochSec(latest.timestamp);
    if (!/^python/i.test(lang) || !nonEmpty(det.code)){
      const msg = `print("Latest Accepted (#${latest.id}) is not Python; ReferenceSolution unavailable.")`;
      const hdr = [
        `# Reference (Latest Accepted) ${latest.id}`,
        `# Status: ${latest.statusDisplay || ''}`,
        `# Lang: ${lang}`,
        `# Time: ${timeStr || ''}`,
        ''
      ].join('\n');
      return pyCell(hdr + '\n' + msg + '\n');
    }
    const hdr = [
      `# Reference (Latest Accepted) ${latest.id}`,
      `# Status: ${latest.statusDisplay || ''}`,
      `# Lang: ${lang}`,
      `# Time: ${timeStr || ''}`,
      `# This cell defines ReferenceSolution = Solution`,
      ''
    ].join('\n');
    const escaped = det.code.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
    const body = `
# --- begin accepted code (escaped literal) ---
acc_src = """${escaped}"""
exec(acc_src, globals(), globals())
try:
    ReferenceSolution = Solution
    print("ReferenceSolution is set from latest Accepted.")
except Exception as e:
    print("Could not set ReferenceSolution:", e)
# --- end accepted code ---
`;
    return pyCell(hdr + '\n' + body);
  }

  function monacoCell(monacoEditor){
    const lang = monacoEditor.label || '';
    const commentHdr = [
      '# Current Editor Code (Monaco)',
      `# Source: ${monacoEditor.meta?.source || 'monaco'}`,
      `# Lang: ${lang}`,
      ''
    ].join('\n');
    if (/^python/i.test(lang) && nonEmpty(monacoEditor.code)){
      return pyCell(commentHdr + '\n' + monacoEditor.code + '\n\nrun_all_cases(Solution)\n');
    }
    const shown = nonEmpty(monacoEditor.code) ? monacoEditor.code : '(no code captured)';
    const body = `print("Non-Python editor language; showing source but not executing.")\nSRC = r"""\\\n${shown.replace(/\\/g,'\\\\').replace(/"""/g,'\\"""')}\\\n"""\nprint(SRC)\n`;
    return pyCell(commentHdr + '\n' + body);
  }

  function localStorageCell(storageScan){
    const hdr = [
      '# Current Code from localStorage (heuristic)',
      storageScan.meta?.key ? `# Key: ${storageScan.meta.key}` : '# Key: (unknown)',
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
    const lang = inferLang(storageScan.code);

    if (/^python/i.test(lang)){
      return pyCell(hdr + '\n' + storageScan.code + '\n\nrun_all_cases(Solution)\n');
    }
    const shown = storageScan.code;
    const body = `print("LocalStorage code not Python; showing source but not executing.")\nSRC = r"""\\\n${shown.replace(/\\/g,'\\\\').replace(/"""/g,'\\"""')}\\\n"""\nprint(SRC)\n`;
    return pyCell(hdr + '\n' + body);
  }

  function submissionCell(r, detailsById){
    const d=detailsById[r.id] || {};
    const lang = d.lang || r.lang || '';
    const timeStr=toLocalStringFromEpochSec(r.timestamp);
    const hdr = [
      `# Submission ${r.id}`,
      `# Status: ${r.statusDisplay || ''}`,
      `# Lang: ${lang}`,
      `# Time: ${timeStr || ''}`,
      r.runtimeMs!=null ? `# Runtime (ms): ${r.runtimeMs}` : `# Runtime: ${r.runtimeStr || ''}`,
      r.runtimeBeats!=null ? `# Runtime Beats %: ${fmtPct(r.runtimeBeats)}` : `# Runtime Beats %:`,
      r.memoryMB!=null ? `# Memory (MB): ${r.memoryMB}` : `# Memory: ${r.memoryStr || ''}`,
      r.memoryBeats!=null ? `# Memory Beats %: ${fmtPct(r.memoryBeats)}` : `# Memory Beats %:`,
      r.note ? `# Notes: ${r.note.replace(/\n+/g,' ')}` : `# Notes:`,
      ''
    ].join('\n');

    if (/^python/i.test(lang) && nonEmpty(d.code)){
      return pyCell(hdr + '\n' + d.code + '\n\nrun_all_cases(Solution)\n');
    }
    const shown = nonEmpty(d.code) ? d.code : '(no code available for this submission)';
    const body = `print("Non-Python submission; showing source but not executing.")\nSRC = r"""\\\n${shown.replace(/\\/g,'\\\\').replace(/"""/g,'\\"""')}\\\n"""\nprint(SRC)\n`;
    return pyCell(hdr + '\n' + body);
  }

  function buildNotebook(q, solved, descMd, hints, varNames, defaultBlob, capturedBlob, subsRows, detailsById, monacoEditor, storageScan){
    const nb = nbSkeleton();

    // First MD cell
    let md = '';
    md += buildProblemHeader(q, solved);
    md += descMd;
    md += buildHintsSection(hints);
    md += buildTestcasesSection('Testcases', varNames, defaultBlob, capturedBlob);
    md += buildSubmissionsTable(q.titleSlug || getSlugFromPath() || '', subsRows);
    md += '_The next cell defines a shared test harness. Each Python solution cell calls `run_all_cases(Solution)` to execute all unique test cases. If a Python Accepted submission exists, it is added as a Reference and used for validation._\n';
    nb.cells.push(mdCell(md));

    // Harness + optional reference
    const uniqCases = combineUniqueTestcases(varNames, defaultBlob, capturedBlob);
    nb.cells.push(buildHarnessCell(varNames, uniqCases));

    const refCell = buildReferenceCellIfAny(subsRows, detailsById);
    if (refCell) nb.cells.push(refCell);

    // Current Editor + LocalStorage
    nb.cells.push(monacoCell(monacoEditor));
    nb.cells.push(localStorageCell(storageScan));

    // Each submission
    for (const r of subsRows){
      nb.cells.push(submissionCell(r, detailsById));
    }

    const fname = `LC${q.questionId || '0000'}-${q.titleSlug || getSlugFromPath() || 'unknown'}.ipynb`;
    return { notebook: nb, filename: fname };
  }

  /*****************************************************************
   * N. Report assembly & UI actions
   *****************************************************************/
  let LOG_MODE_REQUESTED=false;

  async function onCopyReport(){
    if (busy) return; busy=true; btnReport.disabled=true; btnReport.textContent='Working…'; LOG_ENABLED=false; LOG_LINES=null; LOG_MODE_REQUESTED=false;
    try{
      const out=await runPipeline({ produceReport:true, wantNotebook:false });
      await copyText(out.md);
      showToast('Report copied to clipboard.');
    }
    catch(e){ showToast('Error building report (see console).'); log('Fatal (report): '+(e?.message||e)); }
    finally{ btnReport.disabled=false; btnReport.textContent='Copy Report'; busy=false; }
  }
  async function onCopyLog(){
    if (busy) return; busy=true; btnLog.disabled=true; btnLog.textContent='Working…'; LOG_ENABLED=true; LOG_LINES=[]; LOG_MODE_REQUESTED=true;
    try{ await runPipeline({ produceReport:false, wantNotebook:false }); await copyLogToClipboard(); }
    catch(e){ showToast('Error collecting log (see console).'); log('Fatal (log): '+(e?.message||e)); }
    finally{ btnLog.disabled=false; btnLog.textContent='Copy Log'; busy=false; }
  }
  async function onSaveNotebook(){
    if (busy) return; busy=true; btnSaveNB.disabled=true; btnSaveNB.textContent='Building…';
    LOG_ENABLED=false; LOG_LINES=null; LOG_MODE_REQUESTED=false;
    try{
      const out = await runPipeline({ produceReport:false, wantNotebook:true });
      const nbJSON = JSON.stringify(out.notebook, null, 2);
      const ok = await downloadFile(out.filename, 'application/x-ipynb+json;charset=utf-8', nbJSON);
      showToast(ok ? `Notebook saved: ${out.filename}` : '❌ Failed to save notebook (check console).');
    } catch(e){
      console.error(e);
      showToast('Error building notebook (see console).');
    } finally {
      btnSaveNB.disabled=false; btnSaveNB.textContent='Save .ipynb'; busy=false;
    }
  }

  async function copyText(text){
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else if (typeof GM_setClipboard==='function') GM_setClipboard(text,{type:'text',mimetype:'text/plain'});
    else { const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
  }
  async function copyLogToClipboard(){
    try{
      const text=(LOG_LINES||[]).join('\n');
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else if (typeof GM_setClipboard==='function') GM_setClipboard(text,{type:'text',mimetype:'text/plain'});
      else { const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.execCommand('copy'); document.body.removeChild(ta); }
      showToast('Log copied to clipboard.');
    } catch(e){ showToast('Failed to copy log (see console).'); log('Clipboard copy failed: ' + (e?.message||e)); }
  }

  /* ------------------------ REORDERED: glossary first ------------------------ */
  async function runPipeline({ produceReport, wantNotebook }){
    log('Begin: pipeline start.'); log(`Origin: ${location.origin}`); log(`Path: ${location.pathname}`);
    const slug=getSlugFromPath(); if (!slug){ log('Error: could not detect problem slug.'); throw new Error('No problem slug in URL.'); }
    log(`Detected slug: ${slug}`);

    // Kick off network calls but don't await yet
    const qP     = fetchQuestion(slug);
    const subsP  = fetchSubmissionsForSlug(slug);
    const hintsP = fetchHints(slug).catch(()=>[]);

    // ⬇️ Capture glossary FIRST so the popup shows immediately
    const pairs = await captureGlossaryFromLiveDescription();

    // Now await network results in parallel
    const [q, subs, hints] = await Promise.all([qP, subsP, hintsP]);

    const rows=[]; const detailsById={}; let idx=0;
    for (const s of subs){
      idx+=1; log(`Details: fetching submission ${s.id}…`);
      const d=await fetchSubmissionDetailsGraphQL(s.id);
      let merged = d;
      const isAC = /accepted/i.test(s.statusDisplay);
      if (isAC && (merged.runtimeBeats == null || merged.memoryBeats == null || merged.runtimeMs == null || merged.memoryMB == null)){
        const rest = await fetchBeatsViaCheck(s.id);
        merged = mergeDetail(merged, rest);
      }
      detailsById[s.id] = { code: merged.code || '', lang: merged.lang || s.lang || '' };
      const row={
        idx, id:s.id, statusDisplay:s.statusDisplay||'', timestamp:s.timestamp||null, lang:s.lang || merged.lang || '',
        runtimeMs: merged.runtimeMs ?? null, memoryMB: merged.memoryMB ?? null,
        runtimeBeats: merged.runtimeBeats ?? null, memoryBeats: merged.memoryBeats ?? null,
        note: merged.note || ''
      };
      rows.push(row);
      log(`Row: id=${row.id} status=${row.statusDisplay} rt(ms)=${row.runtimeMs??''} rb=${fmtPct(row.runtimeBeats)} mem(MB)=${row.memoryMB??''} mb=${fmtPct(row.memoryBeats)}`);
      if (rows.length>=MAX_SUBMISSIONS) break;
      await sleep(BETWEEN_DETAIL_MS);
    }

    const monacoEditor = await grabMonacoOnlyCodeAndLang(q);
    const storageScan  = scanLocalStorageHeuristic(slug, q);
    const lsRaw = (storageScan && storageScan.ok && storageScan.code) ? storageScan.code : '';
    storageScan.code = commentOutsideFences(lsRaw, { commentPrefix: '# ' });

    // ⬇️ Pass pairs into MD builder so it doesn’t recapture later
    const { md: descMd, defaultBlob } = await buildDescriptionAndExamples(q, pairs);
    const capturedBlob = getCustomInput(slug);
    const varNames = getVariableNames(q, capturedBlob, defaultBlob);
    log('Var names: ' + (varNames.join(', ') || '(none)'));

    const solved = rows.some(r => /accepted/i.test(r.statusDisplay));

    // Report
    let md = '';
    if (produceReport){
      md += buildProblemHeader(q, solved);
      md += descMd;
      md += buildHintsSection(hints);
      md += buildTestcasesSection('Testcases', varNames, defaultBlob, capturedBlob);

      // Editor & localStorage code (text only)
      md += '## Current Editor Code — Monaco\n\n';
      if (monacoEditor && nonEmpty(monacoEditor.code)){
        const safeCode = sanitizeCodeForMarkdown(monacoEditor.code);
        md += `*Source:* \`${monacoEditor.meta?.source || 'monaco'}\`${monacoEditor.label?` &nbsp;&nbsp; *Lang:* ${monacoEditor.label}`:''}\n\n`;
        md += `\`\`\`${monacoEditor.fence}\n${safeCode}\n\`\`\`\n\n`;
      } else { md += `*(not found — try focusing the editor or switching to the code tab)*\n\n`; }

      md += '## Current Editor Code — localStorage (heuristic)\n\n';
      if (storageScan && storageScan.ok && nonEmpty(storageScan.code)){
        const lbl = (function inferLangFromCode(t){
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
        })(storageScan.code);
        const fence = normalizeFenceFromLabel(lbl);
        const meta = storageScan.meta?.key ? `*Key:* \`${storageScan.meta.key}\`` : '*Key:* (unknown)';
        const safeCode = sanitizeCodeForMarkdown(storageScan.code);
        md += `${meta}${lbl ? ` &nbsp;&nbsp; *Lang guess:* ${lbl}` : ''}\n\n`;
        md += `\`\`\`${fence}\n${safeCode}\n\`\`\`\n\n`;
      } else { const why = storageScan?.meta?.error ? ` — ${storageScan.meta.error}` : ''; md += `*(no plausible code found in localStorage${why})*\n\n`; }

      md += buildSubmissionsTable(slug, rows);

      // Per-submission code blocks
      const parts=['## Submission Code'];
      for (const r of rows){
        const d=detailsById[r.id] || {}; const langLabel=d.lang || r.lang || 'Text';
        const fence=normalizeFenceFromLabel(langLabel); const timeStr=toLocalStringFromEpochSec(r.timestamp);
        const header=`### Submission ${r.id} — ${r.statusDisplay || ''} — ${langLabel}${timeStr ? ' — ' + timeStr : ''}`;
        const codeRaw=nonEmpty(d.code) ? d.code : '';
        const safe = sanitizeCodeForMarkdown(codeRaw);
        const body = nonEmpty(codeRaw)
          ? (CODE_BLOCK_COLLAPSE ? `<details><summary>show code</summary>\n\n\`\`\`${fence}\n${safe}\n\`\`\`\n\n</details>` : `\n\`\`\`${fence}\n${safe}\n\`\`\`\n`)
          : '\n*(no code available)*\n';
        parts.push(`${header}${body}\n`);
      }
      md += parts.join('\n') + '\n';
    }

    // Notebook
    let nbOut = null;
    if (wantNotebook){
      nbOut = buildNotebook(q, solved, descMd, hints, varNames, defaultBlob, capturedBlob, rows, detailsById, monacoEditor, storageScan);
    }

    log('Pipeline finished.');
    return { md, notebook: nbOut?.notebook, filename: nbOut?.filename };
  }

  /*****************************************************************
   * O. Robust file download (.ipynb)
   *****************************************************************/
  async function downloadFile(name, mime, dataStr){
    const DATA_URL = `data:${mime},${encodeURIComponent(dataStr)}`;

    if (typeof GM_download === 'function'){
      try {
        await new Promise((resolve, reject) => {
          GM_download({
            url: DATA_URL,
            name,
            saveAs: true,
            onload: resolve,
            ontimeout: () => reject(new Error('GM_download timeout')),
            onerror: (e) => reject(new Error(e && (e.error || e.details || 'GM_download error')))
          });
        });
        return true;
      } catch (e) {
        console.warn('[LC→MD] GM_download failed, falling back:', e);
      }
    }

    try {
      const a = document.createElement('a');
      a.href = DATA_URL;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) {
      console.warn('[LC→MD] data: anchor download failed, falling back:', e);
    }

    try {
      const blob = new Blob([dataStr], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    } catch (e) {
      console.error('[LC→MD] Blob anchor download failed:', e);
    }

    return false;
  }
})();
