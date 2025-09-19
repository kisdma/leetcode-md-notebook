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

  function nowISO() { try { return new Date().toISOString(); } catch (_) { return ''; } }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function norm(str) { return (str == null) ? '' : String(str).replace(/\s+/g, ' ').trim(); }

  var perf = (pageWindow && pageWindow.performance) || (window && window.performance) || null;
  var perfNow = (perf && typeof perf.now === 'function') ? function () { return perf.now(); } : function () { return Date.now(); };

  var TipWatch = (function () {
    var lastText = '';
    var lastTS = perfNow();

    function scrape() {
      var el = document.querySelector('div.highcharts-tooltip, g.highcharts-tooltip, .highcharts-label.highcharts-tooltip');
      if (!el) return '';
      if (el instanceof HTMLElement) return norm(el.textContent || '');
      var spans = el.querySelectorAll && el.querySelectorAll('text tspan');
      if (spans && spans.length) {
        return norm(Array.prototype.slice.call(spans).map(function (n) { return n.textContent || ''; }).join(' '));
      }
      return norm(el.textContent || '');
    }

    try {
      var observer = new MutationObserver(function () {
        var t = scrape();
        if (t && t !== lastText) {
          lastText = t;
          lastTS = perfNow();
        }
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    } catch (_) { /* noop */ }

    function get() { return { text: lastText, ts: lastTS }; }

    async function waitChange(prev, timeout) {
      var limit = typeof timeout === 'number' ? timeout : 20;
      var start = perfNow();
      for (;;) {
        var cur = get();
        if (cur.ts > prev && cur.text) return cur;
        if (perfNow() - start > limit) return cur;
        await sleep(20);
      }
    }

    function bump() {
      lastText = '';
      lastTS = perfNow();
    }

    return { get: get, waitChange: waitChange, bump: bump };
  })();

  function titleFromChart(chart) {
    if (!chart) return '';
    var t = chart.title && (chart.title.textStr || chart.title.element && chart.title.element.textContent);
    if (t) return norm(t);
    var renderTo = chart.renderTo;
    if (renderTo && renderTo.closest) {
      var container = renderTo.closest('section, article, div');
      if (container) {
        var header = container.querySelector('h1,h2,h3,h4,h5,h6');
        if (header) return norm(header.textContent || '');
      }
    }
    return '';
  }

  function subtitleFromChart(chart) {
    if (!chart) return '';
    var sub = chart.subtitle && (chart.subtitle.textStr || chart.subtitle.element && chart.subtitle.element.textContent);
    return norm(sub);
  }

  function guessKind(chart) {
    var base = (titleFromChart(chart) + ' ' + subtitleFromChart(chart)).toLowerCase();
    if (/runtime/.test(base)) return 'runtime';
    if (/memory/.test(base)) return 'memory';
    return 'histogram';
  }

  function getMouseTarget(svg) {
    if (!svg || !svg.querySelector) return svg;
    return svg.querySelector('.highcharts-tracker, .highcharts-series-group, .highcharts-plot-background') || svg;
  }

  function getPlotBG(svg) {
    if (!svg || !svg.querySelector) return svg;
    return svg.querySelector('.highcharts-plot-background') || svg;
  }

  function centerFromBBox(svg, node) {
    var bb;
    try { bb = node.getBBox(); } catch (_) { bb = null; }
    if (!bb) return { x: 0, y: 0, bb: { width: 0, height: 0 } };
    var cx = bb.x + bb.width / 2;
    var cy = bb.y + Math.max(6, Math.min(20, bb.height / 2));
    var pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    var ctm = (typeof node.getCTM === 'function' && node.getCTM()) || (typeof svg.getScreenCTM === 'function' && svg.getScreenCTM()) || null;
    var p2 = ctm ? pt.matrixTransform(ctm) : { x: cx, y: cy };
    return { x: p2.x, y: p2.y, bb: bb };
  }

  function fire(el, type, x, y) {
    if (!el || typeof el.dispatchEvent !== 'function') return;
    var win = pageWindow || window;
    var opts = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y };
    try {
      el.dispatchEvent(new win.PointerEvent(type, opts));
    } catch (_) {
      try { el.dispatchEvent(new PointerEvent(type, opts)); } catch (__) {}
    }
    var mouseType = type.indexOf('pointer') === 0 ? ('mouse' + type.slice('pointer'.length)) : type;
    try {
      el.dispatchEvent(new win.MouseEvent(mouseType, opts));
    } catch (_) {
      try { el.dispatchEvent(new MouseEvent(mouseType, opts)); } catch (__) {}
    }
  }

  function visibleNonZeroBars(svg) {
    if (!svg || !svg.querySelectorAll) return [];
    var raw = svg.querySelectorAll('.highcharts-point');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var el = raw[i];
      if (!el) continue;
      var bb;
      try { bb = el.getBBox(); } catch (_) { bb = null; }
      if (!bb || bb.width <= 0 || bb.height <= 0) continue;
      var style;
      try { style = window.getComputedStyle ? window.getComputedStyle(el) : null; } catch (_) { style = null; }
      if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) continue;
      out.push(el);
    }
    return out;
  }

  function listCharts() {
    var chartsArr = [];
    if (pageWindow.Highcharts && Array.isArray(pageWindow.Highcharts.charts)) {
      chartsArr = pageWindow.Highcharts.charts;
    } else if (window.Highcharts && Array.isArray(window.Highcharts.charts)) {
      chartsArr = window.Highcharts.charts;
    }
    var out = [];
    for (var i = 0; i < chartsArr.length; i++) {
      if (chartsArr[i]) out.push(chartsArr[i]);
    }
    return out;
  }

  function chartFromSvg(svg) {
    if (!svg) return null;
    var charts = listCharts();
    for (var i = 0; i < charts.length; i++) {
      var chart = charts[i];
      if (!chart) continue;
      var container = chart.container;
      try {
        if (container && typeof container.contains === 'function' && container.contains(svg)) {
          return chart;
        }
      } catch (_) {}
    }
    return null;
  }

  function extractTooltipText(chart, svg, barEl) {
    var container = null;
    if (barEl && typeof barEl.closest === 'function') {
      container = barEl.closest('.highcharts-container');
    }
    if (!container && svg && typeof svg.closest === 'function') {
      container = svg.closest('.highcharts-container');
    }
    if (!container && chart && chart.container) {
      container = chart.container;
    }

    if (container && container.querySelector) {
      var htmlTip = container.querySelector('div.highcharts-tooltip');
      if (htmlTip) {
        var htmlText = norm(htmlTip.textContent || '');
        if (htmlText) return htmlText;
      }
      var svgTip = container.querySelector('g.highcharts-tooltip');
      if (svgTip) {
        var spans = svgTip.querySelectorAll('text tspan');
        if (spans && spans.length) {
          var svgText = norm(Array.prototype.slice.call(spans).map(function (n) { return n.textContent || ''; }).join(' '));
          if (svgText) return svgText;
        }
        var svgText2 = norm(svgTip.textContent || '');
        if (svgText2) return svgText2;
      }
    }

    var tipChart = chart;
    if (!tipChart) {
      var charts = listCharts();
      for (var i = 0; i < charts.length; i++) {
        var c = charts[i];
        if (!c || !c.tooltip) continue;
        try {
          var same = (c.container && container && c.container === container) ||
                     (c.renderTo && container && c.renderTo === container) ||
                     (c.container && container && c.container.id && container.id && c.container.id === container.id) ||
                     (c.renderTo && container && c.renderTo.id && container.id && c.renderTo.id === container.id);
          if (same) { tipChart = c; break; }
        } catch (_) {}
      }
    }

    if (tipChart && tipChart.tooltip && tipChart.tooltip.label) {
      var label = tipChart.tooltip.label;
      var t1 = norm((label.text && label.text.textStr) || label.textStr || '');
      if (t1) return t1;
      var t2 = norm((label.div && label.div.textContent) || '');
      if (t2) return t2;
      var t3 = norm((label.element && label.element.textContent) || '');
      if (t3) return t3;
    }

    var aria = norm((barEl && barEl.getAttribute && barEl.getAttribute('aria-label')) || '');
    if (aria) return aria;
    return '';
  }

  function stringCategory(point, series) {
    if (!point) return '';
    if (point.category != null) return String(point.category);
    if (point.name != null) return String(point.name);
    if (point.options) {
      if (point.options.category != null) return String(point.options.category);
      if (point.options.name != null) return String(point.options.name);
      if (point.options.label != null) return String(point.options.label);
    }
    if (series && series.xAxis && Array.isArray(series.xAxis.categories)) {
      var idx = typeof point.x === 'number' ? Math.round(point.x) : null;
      if (idx != null && idx >= 0 && idx < series.xAxis.categories.length) {
        return String(series.xAxis.categories[idx]);
      }
    }
    if (typeof point.x === 'number') return String(point.x);
    return '';
  }

  function isElementDisplayed(el) {
    if (!el || el.nodeType !== 1) return false;
    var style;
    try { style = window.getComputedStyle ? window.getComputedStyle(el) : null; } catch (_) { style = null; }
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    var rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
    return true;
  }

  function findTabByName(name) {
    if (!name) return null;
    var normName = String(name).trim();
    if (!normName) return null;
    var escaped = normName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    var matcher = new RegExp('\\b' + escaped + '\\b', 'i');
    var nodes = document.querySelectorAll('[role="tab"], [role="button"], button, a, span, div');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isElementDisplayed(el)) continue;
      var text = norm(el.textContent || '');
      if (!text) continue;
      if (matcher.test(text)) return el;
    }
    return null;
  }

  function chartsNearTab(tabEl) {
    var root = tabEl;
    for (var hops = 0; root && hops < 8; hops++) {
      if (root.querySelector && root.querySelector('svg.highcharts-root')) break;
      root = root.parentElement;
    }
    if (!root) root = document;
    var list = root.querySelectorAll ? root.querySelectorAll('svg.highcharts-root') : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var svg = list[i];
      if (!svg) continue;
      var rect = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
      if (rect && rect.width > 0 && rect.height > 0) out.push(svg);
    }
    return out;
  }

  async function waitForChartsNearTab(tabEl, timeout) {
    var limit = typeof timeout === 'number' ? timeout : 1800;
    var start = Date.now();
    for (;;) {
      var svgs = chartsNearTab(tabEl);
      for (var i = 0; i < svgs.length; i++) {
        if (visibleNonZeroBars(svgs[i]).length) return true;
      }
      if (Date.now() - start > limit) return svgs.length > 0;
      await sleep(60);
    }
  }

  async function clickSubpanel(name) {
    var tab = findTabByName(name);
    if (!tab) return { ok: false, tab: null };
    try { tab.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}
    try { tab.click(); } catch (_) {}
    TipWatch.bump();
    await waitForChartsNearTab(tab, 2000);
    return { ok: true, tab: tab };
  }

  async function hoverBarsOnSvg(chart, svg, tooltipMap) {
    if (!chart || !svg) return;
    var bars = visibleNonZeroBars(svg);
    if (!bars.length) return;

    var target = getMouseTarget(svg) || svg;
    var plotBG = getPlotBG(svg);
    var plotPt = null;
    if (plotBG) {
      try {
        var bb = plotBG.getBBox();
        var pt = svg.createSVGPoint();
        pt.x = bb.x + 2;
        pt.y = bb.y + 2;
        var ctm = (typeof plotBG.getCTM === 'function' && plotBG.getCTM()) || (typeof svg.getScreenCTM === 'function' && svg.getScreenCTM()) || null;
        var p2 = ctm ? pt.matrixTransform(ctm) : { x: pt.x, y: pt.y };
        plotPt = { x: p2.x, y: p2.y };
      } catch (_) { plotPt = null; }
    }

    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      var point = (bar && bar.point) || (bar && bar.__dataPoint) || (bar && bar.parentNode && bar.parentNode.point) || null;
      if (!point || !point.series || point.series.chart !== chart) continue;
      if (tooltipMap && tooltipMap.has(point)) continue;

      try { bar.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}

      if (plotPt) {
        fire(target, 'pointermove', plotPt.x, plotPt.y);
        await sleep(20);
        fire(target, 'pointerout', plotPt.x, plotPt.y);
        fire(target, 'pointerleave', plotPt.x, plotPt.y);
      }

      var prevTS = TipWatch.get().ts;
      var pos = centerFromBBox(svg, bar);

      fire(bar, 'pointerover', pos.x, pos.y);
      fire(target, 'pointermove', pos.x, pos.y);
      await sleep(20);

      var dx = Math.max(1.5, pos.bb.width / 4);
      var dy = Math.max(0.5, Math.min(4, pos.bb.height / 6));
      var jiggle = [
        [pos.x + dx, pos.y],
        [pos.x, pos.y + dy],
        [pos.x - dx / 2, pos.y],
        [Math.min(pos.x + Math.max(2, pos.bb.width * 0.35), pos.x + dx * 2), pos.y]
      ];

      for (var j = 0; j < jiggle.length; j++) {
        var pair = jiggle[j];
        fire(target, 'pointermove', pair[0], pair[1]);
        await sleep(20);
      }

      var tipObs = await TipWatch.waitChange(prevTS, 40);
      var text = extractTooltipText(chart, svg, bar) || (tipObs && tipObs.text) || '';
      if (!text) {
        await sleep(20);
        var tip = TipWatch.get();
        text = extractTooltipText(chart, svg, bar) || (tip && tip.text) || '';
      }

      if (tooltipMap) {
        tooltipMap.set(point, norm(text));
      }

      await sleep(16);
    }
  }

  async function processPhase(label, tooltipByChart) {
    var res = await clickSubpanel(label);
    var anchor = res.tab || document.body;
    var svgs = chartsNearTab(anchor);
    var seen = new WeakSet();
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      if (!svg || seen.has(svg)) continue;
      seen.add(svg);
      var chart = chartFromSvg(svg);
      if (!chart) continue;
      var tooltipMap = tooltipByChart.get(chart);
      if (!tooltipMap) {
        tooltipMap = new Map();
        tooltipByChart.set(chart, tooltipMap);
      }
      await hoverBarsOnSvg(chart, svg, tooltipMap);
    }
  }

  async function processAllPhases(tooltipByChart) {
    var labels = ['Runtime', 'Memory'];
    for (var i = 0; i < labels.length; i++) {
      try {
        await processPhase(labels[i], tooltipByChart);
      } catch (_) {}
    }
  }

  async function waitForAnyChart(timeout) {
    var limit = typeof timeout === 'number' ? timeout : 2000;
    var start = Date.now();
    while (Date.now() - start <= limit) {
      if (document.querySelector('svg.highcharts-root')) return true;
      await sleep(100);
    }
    return false;
  }

  function extractSeries(chart, series, tooltipMap) {
    if (!series || !Array.isArray(series.data) || !series.data.length) return null;
    var svg = (chart && chart.container && chart.container.querySelector) ? chart.container.querySelector('svg.highcharts-root') : null;
    var points = [];
    for (var i = 0; i < series.data.length; i++) {
      var p = series.data[i];
      if (!p) continue;
      var label = stringCategory(p, series);
      var value = (p.y != null) ? Number(p.y) : null;
      var tooltip = tooltipMap && tooltipMap.get(p) || null;
      if (!tooltip && (p.pointTooltip || typeof p.getLabelText === 'function')) {
        try { tooltip = norm(p.getLabelText && p.getLabelText()); } catch (_) {}
      }
      if (!tooltip && p.graphic && p.graphic.element) {
        tooltip = extractTooltipText(chart, svg, p.graphic.element) || null;
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

  function gatherOnce(tooltipByChart) {
    var chartsArr = listCharts();
    var out = [];
    for (var i = 0; i < chartsArr.length; i++) {
      var chart = chartsArr[i];
      if (!chart || !chart.series || !chart.series.length) continue;
      var collected = [];
      var tooltipMap = tooltipByChart ? tooltipByChart.get(chart) : null;
      for (var s = 0; s < chart.series.length; s++) {
        var series = chart.series[s];
        if (!series || series.visible === false) continue;
        var serData = extractSeries(chart, series, tooltipMap);
        if (serData) collected.push(serData);
      }
      if (!collected.length) continue;
      out.push({
        chartIndex: i,
        kind: guessKind(chart),
        title: titleFromChart(chart),
        subtitle: subtitleFromChart(chart),
        renderToId: (chart.renderTo && chart.renderTo.id) || null,
        series: collected
      });
    }
    return out;
  }

  async function capture(opts) {
    opts = opts || {};
    var timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 2000;
    var interval = typeof opts.intervalMs === 'number' ? opts.intervalMs : 120;
    var deadline = Date.now() + timeout;
    var tooltipByChart = new Map();
    var lastCharts = [];

    await waitForAnyChart(Math.min(timeout, 4000));

    while (Date.now() <= deadline) {
      await processAllPhases(tooltipByChart);
      var charts = gatherOnce(tooltipByChart);
      if (charts.length) {
        return { ok: true, charts: charts, capturedAt: nowISO() };
      }
      lastCharts = charts;
      await sleep(interval);
    }
    return { ok: false, charts: lastCharts || [], capturedAt: nowISO(), meta: { error: 'histograms not found' } };
  }

  CAP.histograms = {
    __ready__: true,
    capture: capture
  };

})(window.LCMD);
