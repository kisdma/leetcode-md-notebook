/* src/dom/selectors.js
 * Small, dependency-free helpers for robust DOM querying on LeetCode pages.
 *
 * Focus:
 *  - Safe, defensive selectors with graceful fallbacks
 *  - Visibility-aware queries
 *  - Useful finders for LC description area, glossary popups, and language label
 *
 * Public API (LCMD.dom.selectors):
 *   qs(sel, root?)                         -> Element|null
 *   qsa(sel, root?)                        -> Element[]              // array, not NodeList
 *   firstVisible(sel, root?)               -> Element|null
 *   allVisible(sel, root?)                 -> Element[]
 *
 *   descriptionRoot()                      -> Element|null           // main problem statement container
 *   glossaryButtonsInDescription(limit=50) -> HTMLButtonElement[]    // candidate term buttons with text
 *   popupCandidates()                      -> Element[]              // open popovers/tooltips/dialogs
 *   nearestOpenPopup(fromEl, radiusPx=500) -> Element|null           // closest popup near `fromEl`
 *
 *   visibleLanguageLabel()                 -> string|null            // inferred editor language label
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var DOM = NS.defineNS('dom');
  var existing = DOM.selectors || DOM.sel;
  if (existing && existing.__ready__) return;

  var ready = (DOM && DOM.ready) || {};
  var log   = (NS.core && NS.core.log) || { debug:function(){}, info:function(){}, warn:function(){}, error:function(){} };

  /* -------------------------------- utils -------------------------------- */

  function isVisible(el){
    // Prefer shared impl if present
    if (ready && typeof ready.isVisible === 'function') return ready.isVisible(el);
    if (!el) return false;
    try{
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }catch(_){ return false; }
  }

  function qs(sel, root){
    try { return (root || document).querySelector(sel); } catch(_){ return null; }
  }
  function qsa(sel, root){
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch(_){ return []; }
  }

  function firstVisible(sel, root){
    var list = qsa(sel, root);
    for (var i=0;i<list.length;i++) if (isVisible(list[i])) return list[i];
    return null;
  }
  function allVisible(sel, root){
    return qsa(sel, root).filter(isVisible);
  }

  /* ----------------------------- LC selectors ---------------------------- */

  var SELECTORS = {
    DESCRIPTION_ROOT: [
      '[data-cy="description-content"]',
      '[data-key="description-content"]',
      'section[aria-labelledby*="description"]',
      '[data-track-load*="description"]'
    ],
    GLOSSARY_BUTTONS: [
      // LeetCode currently renders terms as <button aria-haspopup="dialog">TERM</button>
      'button[aria-haspopup="dialog"]',
      'button[aria-controls^="radix-"]'
    ],
    POPUP_ROOTS: [
      // Common popper/portal containers in LC and Radix-UI
      '[role="dialog"]',
      '[role="tooltip"]',
      '[data-radix-popper-content-wrapper]',
      '[data-portal] [role="dialog"]',
      '[data-portal] [role="tooltip"]',
      '[data-portal] [data-state="open"]',
      '[data-state="open"]'
    ],
    LANGUAGE_LABELS: [
      // Language combobox/label near the editor (varies per A/B & locale)
      '[data-cy="lang-select"] .ant-select-selection-item',
      '.ant-select-selector .ant-select-selection-item',
      'button[aria-label*="Language"]',
      'div[role="combobox"]'
    ]
  };

  function descriptionRoot(){
    for (var i=0;i<SELECTORS.DESCRIPTION_ROOT.length;i++){
      var el = firstVisible(SELECTORS.DESCRIPTION_ROOT[i], document);
      if (el) return el;
    }
    // Fallback: try the main content area and look for rich text blocks
    var heur = firstVisible('main, [class*="content"], [data-cy*="content"]', document);
    return heur || null;
  }

  function glossaryButtonsInDescription(limit){
    if (typeof limit !== 'number' || limit <= 0) limit = 50;
    var root = descriptionRoot();
    if (!root) return [];
    var combined = SELECTORS.GLOSSARY_BUTTONS.join(', ');
    var btns = qsa(combined, root)
      .filter(function(b){
        var t = (b.textContent || '').trim();
        return isVisible(b) && t.length > 0;
      });
    if (btns.length > limit) btns.length = limit;
    return btns;
  }

  function popupCandidates(){
    var combined = SELECTORS.POPUP_ROOTS.join(', ');
    return allVisible(combined, document);
  }

  function nearestOpenPopup(fromEl, radiusPx){
    radiusPx = typeof radiusPx === 'number' ? radiusPx : 500;
    var vis = popupCandidates();
    if (!fromEl || vis.length === 0) return null;
    var br = fromEl.getBoundingClientRect();
    var bc = { x: br.left + br.width/2, y: br.top + br.height/2 };
    var best = null;
    for (var i=0;i<vis.length;i++){
      var el = vis[i];
      try{
        var r = el.getBoundingClientRect();
        var ec = { x: r.left + r.width/2, y: r.top + r.height/2 };
        var dx = bc.x - ec.x, dy = bc.y - ec.y;
        var d = Math.sqrt(dx*dx + dy*dy);
        if (d <= radiusPx && (!best || d < best.d)) best = { el: el, d: d };
      }catch(_){}
    }
    return best ? best.el : null;
  }

  /* -------------------------- language label finder -------------------------- */

  var KNOWN_LANGS = [
    'Python3','Python','C++','Java','JavaScript','TypeScript','C#','Go',
    'Kotlin','Swift','PHP','Ruby','Rust','Scala','R','SQL'
  ];

  function visibleLanguageLabel(){
    // 1) Direct label in common locations
    for (var i=0;i<SELECTORS.LANGUAGE_LABELS.length;i++){
      var node = firstVisible(SELECTORS.LANGUAGE_LABELS[i], document);
      var tt = node && node.textContent ? node.textContent.trim() : '';
      if (tt) return tt;
    }
    // 2) Heuristic: scan editor region for known tokens
    var scope = qs('[class*="editor"]', document) || document.body;
    var txt = (scope && scope.textContent) ? scope.textContent : '';
    for (var j=0;j<KNOWN_LANGS.length;j++){
      if (txt.indexOf(KNOWN_LANGS[j]) !== -1) return KNOWN_LANGS[j];
    }
    return null;
  }

  /* -------------------------------- export -------------------------------- */
  var API = {
    __ready__: true,
    // primitives
    qs: qs,
    qsa: qsa,
    firstVisible: firstVisible,
    allVisible: allVisible,
    // LC helpers
    descriptionRoot: descriptionRoot,
    glossaryButtonsInDescription: glossaryButtonsInDescription,
    popupCandidates: popupCandidates,
    nearestOpenPopup: nearestOpenPopup,
    // misc
    visibleLanguageLabel: visibleLanguageLabel
  };

  DOM.selectors = API;
  DOM.sel = API; // legacy alias

})(window.LCMD);
