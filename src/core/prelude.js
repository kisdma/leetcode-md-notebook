// src/core/prelude.js
// Minimal global namespace creator for the Tampermonkey sandbox.
// Must be the FIRST @require in the bootstrap metadata.
(function (root) {
  // IMPORTANT: use the userscript sandbox, not unsafeWindow.
  var g = root || (typeof window !== 'undefined' ? window : this);

  if (!g.LCMD) g.LCMD = {};
  // Ensure expected top-level buckets exist so other modules can attach safely.
  g.LCMD.core    = g.LCMD.core    || {};
  g.LCMD.util    = g.LCMD.util    || {};
  g.LCMD.dom     = g.LCMD.dom     || {};
  g.LCMD.net     = g.LCMD.net     || {};
  g.LCMD.capture = g.LCMD.capture || {};
  g.LCMD.lc      = g.LCMD.lc      || {};
  g.LCMD.md      = g.LCMD.md      || {};
  g.LCMD.nb      = g.LCMD.nb      || {};
  g.LCMD.ui      = g.LCMD.ui      || {};

  // tiny breadcrumb so you can confirm it ran
  try { console.info('[LCMD/PRELUDE] namespace initialized'); } catch (_) {}
})(typeof window !== 'undefined' ? window : this);
