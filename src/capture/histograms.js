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

  var LOG_PREFIX = '[LCMD/hist]';

  function logEvent(event, payload) {
    try {
      var parts = [LOG_PREFIX, event];
      if (payload && typeof payload === 'object') {
        Object.keys(payload).slice(0, 12).forEach(function (key) {
          var val = payload[key];
          if (val === undefined) return;
          var type = typeof val;
          if (val === null || type === 'number' || type === 'boolean') {
            parts.push(key + '=' + val);
          } else if (type === 'string') {
            parts.push(key + '=' + val);
          } else {
            try {
              parts.push(key + '=' + JSON.stringify(val));
            } catch (_) {
              parts.push(key + '=' + String(val));
            }
          }
        });
      }
      console.log(parts.join(' '));
    } catch (e) {
      try { console.log(LOG_PREFIX, event); } catch (_) {}
    }
  }

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
    var opts = {
      bubbles: true,
      cancelable: true,
      view: win,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      buttons: 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0.5
    };
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



  function getChartEntry(store, chart) {
    if (!chart) return null;
    var entry = store.get(chart);
    if (!entry) {
      entry = { chart: chart, tooltips: new Map(), phases: new Set() };
      store.set(chart, entry);
      logEvent('chart.bind', { chartIndex: chart.index != null ? chart.index : null, title: norm(titleFromChart(chart) || '') });
    }
    return entry;
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
    var label = norm((tabEl && tabEl.textContent) || '').slice(0, 60);
    var start = Date.now();
    logEvent('waitCharts.start', { label: label, timeout: limit });
    while (Date.now() - start <= limit) {
      var svgs = chartsNearTab(tabEl);
      for (var i = 0; i < svgs.length; i++) {
        var bars = visibleNonZeroBars(svgs[i]).length;
        if (bars) {
          logEvent('waitCharts.ready', { label: label, elapsed: Date.now() - start, svgs: svgs.length, bars: bars });
          return true;
        }
      }
      await sleep(60);
    }
    var remaining = chartsNearTab(tabEl).length;
    logEvent('waitCharts.timeout', { label: label, elapsed: Date.now() - start, svgs: remaining });
    return remaining > 0;
  }

  async function clickSubpanel(name) {
    logEvent('tab.search', { label: name });
    var tab = findTabByName(name);
    if (!tab) {
      logEvent('tab.search.miss', { label: name });
      return { ok: false, tab: null };
    }
    try { tab.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}
    try { tab.click(); logEvent('tab.clicked', { label: name }); } catch (_) { logEvent('tab.click.error', { label: name }); }
    TipWatch.bump();
    var ready = await waitForChartsNearTab(tab, 2000);
    logEvent('tab.ready', { label: name, chartsReady: ready });
    return { ok: true, tab: tab, chartsReady: ready };
  }
  async function hoverBarsOnSvg(svg, phaseLabel, store) {
    if (!svg) {
      logEvent('hover.skip', { reason: 'missingSvg', phase: phaseLabel });
      return;
    }
    var bars = visibleNonZeroBars(svg);
    logEvent('hover.start', { phase: phaseLabel, svgId: svg.id || null, bars: bars.length });
    if (!bars.length) {
      logEvent('hover.empty', { phase: phaseLabel, reason: 'noVisibleBars' });
      return;
    }

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

    var hovered = 0;
    var lastEntry = null;
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      var point = (bar && bar.point) || (bar && bar.__dataPoint) || (bar && bar.parentNode && bar.parentNode.point) || null;
      var chart = point && point.series && point.series.chart;
      if (!point || !chart) {
        logEvent('hover.point.skip', { phase: phaseLabel, idx: i, reason: 'noPoint' });
        continue;
      }
      var entry = getChartEntry(store, chart);
      lastEntry = entry;
      if (!entry || !entry.tooltips) {
        logEvent('hover.point.skip', { phase: phaseLabel, idx: i, reason: 'noEntry' });
        continue;
      }
      if (entry.phases) entry.phases.add(phaseLabel || '');
      var tooltipMap = entry.tooltips;
      if (tooltipMap.has(point)) {
        logEvent('hover.point.skip', { phase: phaseLabel, idx: i, reason: 'alreadyCaptured' });
        continue;
      }

      try { bar.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}

      if (plotPt) {
        fire(target, 'pointermove', plotPt.x, plotPt.y);
        await sleep(20);
        fire(target, 'pointerout', plotPt.x, plotPt.y);
        fire(target, 'pointerleave', plotPt.x, plotPt.y);
      }

      var prevTS = TipWatch.get().ts;
      var pos = centerFromBBox(svg, bar);
      var categoryPreview = stringCategory(point, point.series) || '';
      logEvent('hover.point.begin', { phase: phaseLabel, idx: i, category: categoryPreview, series: norm((point.series && point.series.name) || ''), hasGraphic: !!(point.graphic && point.graphic.element) });

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

      var tooltipSource = '';
      var tipObs = await TipWatch.waitChange(prevTS, 40);
      var text = extractTooltipText(chart, svg, bar);
      if (text) {
        tooltipSource = 'dom';
      } else if (tipObs && tipObs.text) {
        text = tipObs.text;
        tooltipSource = 'tipwatch';
      }
      if (!text) {
        await sleep(20);
        var tipNext = TipWatch.get();
        var retry = extractTooltipText(chart, svg, bar) || (tipNext && tipNext.text) || '';
        if (retry) {
          text = retry;
          if (!tooltipSource) {
            tooltipSource = tipNext && tipNext.text ? 'tipwatch-late' : 'dom-retry';
          }
        }
      }

      if (text) {
        var normalized = norm(text);
        tooltipMap.set(point, normalized);
        hovered++;
        logEvent('hover.point.tooltip', { phase: phaseLabel, idx: i, source: tooltipSource || 'unknown', length: normalized.length, preview: normalized.slice(0, 120) });
      } else {
        logEvent('hover.point.tooltip.miss', { phase: phaseLabel, idx: i });
      }

      await sleep(16);
    }

    var stored = lastEntry && lastEntry.tooltips ? lastEntry.tooltips.size : 0;
    logEvent('hover.complete', { phase: phaseLabel, hovered: hovered, stored: stored });
  }


  async function processPhase(label, store) {
    logEvent('phase.start', { label: label });
    var res = await clickSubpanel(label);
    logEvent('phase.tab', { label: label, ok: !!(res && res.ok), chartsReady: !!(res && res.chartsReady) });
    if (!res || !res.ok) {
      return;
    }
    var anchor = res.tab || document.body;
    var svgs = chartsNearTab(anchor);
    logEvent('phase.svgs', { label: label, count: svgs.length });
    var seen = new WeakSet();
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      if (!svg) continue;
      if (seen.has(svg)) {
        logEvent('phase.svg.skip', { label: label, index: i, reason: 'duplicate' });
        continue;
      }
      seen.add(svg);
      await hoverBarsOnSvg(svg, label, store);
    }
  }


  async function processAllPhases(store) {
    var labels = ['Runtime', 'Memory'];
    logEvent('phases.start', { labels: labels.join(',') });
    for (var i = 0; i < labels.length; i++) {
      try {
        await processPhase(labels[i], store);
      } catch (e) {
        logEvent('phase.error', { label: labels[i], message: e && e.message });
      }
    }
    logEvent('phases.complete', { labels: labels.join(','), processed: labels.length });
  }

  async function waitForAnyChart(timeout) {
    var limit = typeof timeout === 'number' ? timeout : 2000;
    var start = Date.now();
    logEvent('waitForAnyChart.start', { timeout: limit });
    while (Date.now() - start <= limit) {
      if (document.querySelector('svg.highcharts-root')) {
        logEvent('waitForAnyChart.ready', { elapsed: Date.now() - start });
        return true;
      }
      await sleep(100);
    }
    logEvent('waitForAnyChart.timeout', { elapsed: Date.now() - start });
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

  function gatherOnce(store) {
    var out = [];
    if (!store || typeof store.forEach !== 'function') {
      logEvent('gather.complete', { charts: 0, reason: 'noStore' });
      return out;
    }
    store.forEach(function (entry, chart) {
      if (!entry || !chart || !(entry.tooltips instanceof Map) || entry.tooltips.size === 0) return;
      var seriesMap = new Map();
      entry.tooltips.forEach(function (tip, point) {
        if (!point || !point.series) return;
        var seriesObj = point.series;
        var seriesEntry = seriesMap.get(seriesObj);
        if (!seriesEntry) {
          seriesEntry = {
            ref: seriesObj,
            data: { name: seriesObj.name || '', type: seriesObj.type || '', points: [] }
          };
          seriesMap.set(seriesObj, seriesEntry);
        }
        var idx = (typeof point.index === 'number') ? point.index : ((typeof point.x === 'number') ? point.x : seriesEntry.data.points.length);
        seriesEntry.data.points.push({
          index: idx,
          category: stringCategory(point, seriesObj),
          value: (point.y != null) ? Number(point.y) : null,
          rawLabel: tip || null
        });
      });
      if (!seriesMap.size) return;
      var seriesArr = [];
      seriesMap.forEach(function (wrapper) {
        wrapper.data.points.sort(function (a, b) {
          var ai = typeof a.index === 'number' ? a.index : 0;
          var bi = typeof b.index === 'number' ? b.index : 0;
          return ai - bi;
        });
        seriesArr.push(wrapper.data);
      });
      seriesArr.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      out.push({
        chartIndex: chart.index != null ? chart.index : null,
        kind: guessKind(chart),
        title: titleFromChart(chart),
        subtitle: subtitleFromChart(chart),
        renderToId: (chart.renderTo && chart.renderTo.id) || null,
        series: seriesArr
      });
    });
    logEvent('gather.complete', { charts: out.length });
    return out;
  }



  async function capture(opts) {
    opts = opts || {};
    var timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 2000;
    var interval = typeof opts.intervalMs === 'number' ? opts.intervalMs : 120;
    var deadline = Date.now() + timeout;
    var chartStore = new Map();
    var lastCharts = [];
    var attempt = 0;

    logEvent('capture.start', { timeout: timeout, interval: interval });
    await waitForAnyChart(Math.min(timeout, 4000));

    while (Date.now() <= deadline) {
      attempt += 1;
      logEvent('capture.attempt', { attempt: attempt, chartsTracked: chartStore.size });
      await processAllPhases(chartStore);
      var charts = gatherOnce(chartStore);
      if (charts.length) {
        logEvent('capture.success', { attempt: attempt, charts: charts.length });
        return { ok: true, charts: charts, capturedAt: nowISO() };
      }
      lastCharts = charts;
      logEvent('capture.retry', { attempt: attempt, charts: charts.length });
      await sleep(interval);
    }
    logEvent('capture.fail', { attempts: attempt, lastCharts: lastCharts.length });
    return { ok: false, charts: lastCharts || [], capturedAt: nowISO(), meta: { error: 'histograms not found' } };
  }

  CAP.histograms = {
    __ready__: true,
    capture: capture
  };

})(window.LCMD);
