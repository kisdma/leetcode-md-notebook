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

  function extractSeries(series){
    if (!series || !Array.isArray(series.data) || !series.data.length) return null;
    var points = [];
    for (var i = 0; i < series.data.length; i++){
      var p = series.data[i];
      if (!p) continue;
      var label = stringCategory(p, series);
      var value = (p.y != null) ? Number(p.y) : null;
      var tooltip = null;
      if (p.pointTooltip || typeof p.getLabelText === 'function'){
        try { tooltip = norm(p.getLabelText && p.getLabelText()); } catch (_) {}
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

  function gatherOnce(){
    var chartsArr = (window.Highcharts && Array.isArray(window.Highcharts.charts)) ? window.Highcharts.charts : [];
    var out = [];
    for (var i = 0; i < chartsArr.length; i++) {
      var chart = chartsArr[i];
      if (!chart || !chart.series || !chart.series.length) continue;
      var collected = [];
      for (var s = 0; s < chart.series.length; s++){
        var series = chart.series[s];
        if (!series || series.visible === false) continue;
        var serData = extractSeries(series);
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
    var lastCharts = [];
    while (Date.now() <= deadline){
      var charts = gatherOnce();
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
