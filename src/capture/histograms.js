/* src/capture/histograms.js
 * Extract runtime/memory histogram data from Highcharts instances on the page.
 *
 * Public API:
 *   LCMD.capture.histograms.capture(opts?) -> Promise<{ ok, charts: Array, capturedAt?, meta? }>
 */
(function (NS) {
  'use strict';
  if (!NS || !NS.defineNS) return;

  var CAP = NS.defineNS('capture');

  // Access the real page window to reach Highcharts
  var pageWindow;
  try {
    pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  } catch (_) {
    pageWindow = window;
  }

  var existing = CAP.histograms;
  if (existing && existing.__ready__) return;

  function nowISO(){ try { return new Date().toISOString(); } catch(_) { return ''; } }
  function sleep(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  function norm(str){ return (str == null) ? '' : String(str).replace(/\s+/g, ' ').trim(); }

  function titleFromChart(chart){
    if (!chart) return '';
    var t = chart.title && (chart.title.textStr || chart.title.element && chart.title.element.textContent);
    if (t) return norm(t);
    var renderTo = chart.renderTo;
    if (renderTo && renderTo.closest){
      var container = renderTo.closest('section, article, div');
      if (container){
        var header = container.querySelector('h1,h2,h3,h4,h5,h6');
        if (header) return norm(header.textContent || '');
      }
    }
    return '';
  }

  function subtitleFromChart(chart){
    if (!chart) return '';
    var sub = chart.subtitle && (chart.subtitle.textStr || chart.subtitle.element && chart.subtitle.element.textContent);
    return norm(sub);
  }

  function guessKind(chart){
    var base = (titleFromChart(chart) + ' ' + subtitleFromChart(chart)).toLowerCase();
    if (/runtime/.test(base)) return 'runtime';
    if (/memory/.test(base)) return 'memory';
    return 'histogram';
  }

  function tooltipFromPoint(chart, point){
    if (!chart || !point) return '';
    var tip = chart.tooltip;
    if (!tip || typeof tip.refresh !== 'function') return '';
    var text = '';
    try {
      tip.refresh(point);
      var label = tip.label;
      if (label) {
        if (label.div && label.div.textContent) {
          text = label.div.textContent;
        } else if (label.element && label.element.textContent) {
          text = label.element.textContent;
        } else if (typeof label.textStr === 'string') {
          text = label.textStr;
        } else if (label.text && typeof label.text.textStr === 'string') {
          text = label.text.textStr;
        }
      }
      if (!text && Array.isArray(tip.tt)) {
        text = tip.tt.map(function(part){
          if (!part) return '';
          if (part.div && part.div.textContent) return part.div.textContent;
          if (part.element && part.element.textContent) return part.element.textContent;
          return part.textStr || '';
        }).join(' ');
      }
    } catch (_) {
      text = '';
    } finally {
      try { tip.hide && tip.hide(0); } catch (_) {}
    }
    return norm(text);
  }

  function tooltipFromDom(barEl){
    if (!barEl || !barEl.closest) return '';
    var container = barEl.closest('.highcharts-container');
    if (!container) return '';
    var htmlTip = container.querySelector('div.highcharts-tooltip');
    if (htmlTip && htmlTip.textContent) {
      return norm(htmlTip.textContent);
    }
    var svgTip = container.querySelector('g.highcharts-tooltip');
    if (svgTip) {
      var spans = svgTip.querySelectorAll('text tspan');
      if (spans && spans.length) {
        return norm(Array.prototype.slice.call(spans).map(function(n){ return n.textContent || ''; }).join(' '));
      }
      if (svgTip.textContent) return norm(svgTip.textContent);
    }
    var aria = barEl.getAttribute && barEl.getAttribute('aria-label');
    return norm(aria || '');
  }
  function stringCategory(point, series){
    if (!point) return '';
    if (point.category != null) return String(point.category);
    if (point.name != null) return String(point.name);
    if (point.options){
      if (point.options.category != null) return String(point.options.category);
      if (point.options.name != null) return String(point.options.name);
      if (point.options.label != null) return String(point.options.label);
    }
    if (series && series.xAxis && Array.isArray(series.xAxis.categories)){
      var idx = typeof point.x === 'number' ? Math.round(point.x) : null;
      if (idx != null && idx >= 0 && idx < series.xAxis.categories.length){
        return String(series.xAxis.categories[idx]);
      }
    }
    if (typeof point.x === 'number') return String(point.x);
    return '';
  }

  function extractSeries(chart, series){
    if (!series || !Array.isArray(series.data) || !series.data.length) return null;
    var points = [];
    for (var i = 0; i < series.data.length; i++){
      var p = series.data[i];
      if (!p) continue;
      var label = stringCategory(p, series);
      var value = (p.y != null) ? Number(p.y) : null;
      var tooltip = tooltipFromPoint(chart, p);
      if (!tooltip && (p.pointTooltip || typeof p.getLabelText === 'function')){
        try { tooltip = norm(p.getLabelText && p.getLabelText()); } catch (_) {}
      }
      if (!tooltip && p && p.graphic && p.graphic.element){
        tooltip = tooltipFromDom(p.graphic.element);
      }
      points.push({
        index: i,
        category: label,
        value: value,
        rawLabel: tooltip || null
      });
    }
    if (!points.length) return null;
    return {
      name: series.name || '',
      type: series.type || '',
      points: points
    };
  }

  function isElementDisplayed(el){
    if (!el || el.nodeType !== 1) return false;
    var style;
    try { style = window.getComputedStyle ? window.getComputedStyle(el) : null; } catch (_) { style = null; }
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    var rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
    return true;
  }

  function findTabByName(name){
    if (!name) return null;
    var normName = String(name).trim();
    if (!normName) return null;
    var matcher = new RegExp('\\b' + normName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    var nodes = document.querySelectorAll('[role="tab"], [role="button"], button, a, span, div');
    for (var i = 0; i < nodes.length; i++){
      var el = nodes[i];
      if (!isElementDisplayed(el)) continue;
      var text = norm(el.textContent || '');
      if (!text) continue;
      if (matcher.test(text)) return el;
    }
    return null;
  }

  function chartsNearTab(tabEl){
    var root = tabEl;
    for (var hops = 0; root && hops < 8; hops++){
      if (root.querySelector && root.querySelector('svg.highcharts-root')) break;
      root = root.parentElement;
    }
    if (!root) root = document;
    var list = root.querySelectorAll ? root.querySelectorAll('svg.highcharts-root') : [];
    var out = [];
    for (var i = 0; i < list.length; i++){
      var svg = list[i];
      if (!svg) continue;
      var rect = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
      if (rect && rect.width > 0 && rect.height > 0) out.push(svg);
    }
    return out;
  }

  async function waitForChartsNearTab(tabEl, timeout){
    var limit = typeof timeout === 'number' ? timeout : 1800;
    var start = Date.now();
    while (Date.now() - start <= limit){
      var found = chartsNearTab(tabEl);
      if (found.length) return true;
      await sleep(80);
    }
    return false;
  }

  async function clickSubpanel(name){
    var tab = findTabByName(name);
    if (!tab) return { ok: false, tab: null };
    try { tab.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}
    try { tab.click(); } catch (_) {}
    await waitForChartsNearTab(tab, 2000);
    return { ok: true, tab: tab };
  }

  async function revealHistogramTabs(){
    var labels = ['Runtime', 'Memory'];
    for (var i = 0; i < labels.length; i++){
      try { await clickSubpanel(labels[i]); } catch (_) {}
      await sleep(120);
    }
  }

  function gatherOnce(){
    var chartsArr = (pageWindow.Highcharts && Array.isArray(pageWindow.Highcharts.charts)) ? pageWindow.Highcharts.charts : [];
    if (!chartsArr.length && window.Highcharts && Array.isArray(window.Highcharts.charts)) {
      chartsArr = window.Highcharts.charts;
    }
    var out = [];
    for (var i = 0; i < chartsArr.length; i++) {
      var chart = chartsArr[i];
      if (!chart || !chart.series || !chart.series.length) continue;
      var collected = [];
      for (var s = 0; s < chart.series.length; s++){
        var series = chart.series[s];
        if (!series || series.visible === false) continue;
        var serData = extractSeries(chart, series);
        if (serData) collected.push(serData);
      }
      if (!collected.length) continue;
      out.push({
        chartIndex: i,
        kind: guessKind(chart),
        title: titleFromChart(chart),
        subtitle: subtitleFromChart(chart),
        renderToId: chart.renderTo && chart.renderTo.id || null,
        series: collected
      });
    }
    return out;
  }

  async function capture(opts){
    opts = opts || {};
    var timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 2000;
    var interval = typeof opts.intervalMs === 'number' ? opts.intervalMs : 120;
    var deadline = Date.now() + timeout;
    var triedReveal = false;
    var lastCharts = [];
    while (Date.now() <= deadline){
      var charts = gatherOnce();
      if (charts.length) {
        return { ok: true, charts: charts, capturedAt: nowISO() };
      }
      lastCharts = charts;
      if (!triedReveal) {
        triedReveal = true;
        try { await revealHistogramTabs(); } catch (_) {}
        charts = gatherOnce();
        if (charts.length) {
          return { ok: true, charts: charts, capturedAt: nowISO() };
        }
        deadline = Math.max(deadline, Date.now() + Math.max(timeout / 2, 1000));
      }
      await sleep(interval);
    }
    return { ok: false, charts: lastCharts || [], capturedAt: nowISO(), meta: { error: 'histograms not found' } };
  }

  CAP.histograms = {
    __ready__: true,
    capture: capture
  };

})(window.LCMD);
