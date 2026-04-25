#!/usr/bin/env python3
"""Comprehensive HME data visualization dashboard.

Reads every metrics/hme-*.json and metrics/holograph/*.json and produces a
single interactive HTML file with multi-panel plotly.js charts. Multi-layered,
sortable, overlayable — opens in any browser without dependencies.

Data sources:
  - metrics/holograph/*.json      → HCI over time, per-category scores
  - metrics/hme-tool-effectiveness.json → session / lifesaver / tool invocation stats
  - log/hme-hook-latency.jsonl → per-hook wall time distribution
  - metrics/hme-trajectory.json   → trend analysis
  - metrics/hme-coupling.json     → tool pair effectiveness matrix
  - metrics/hme-coherence.jsonl   → coherence history from old rag_proxy monitor (may be stale after shim deprecation)
  - metrics/hme-hci-forecast.json → predicted HCI
  - metrics/hme-memetic-drift.json → rule violation counts
  - metrics/hme-verifier-coverage.json → fix commit coverage gaps

Output: metrics/hme-dashboard.html

Panels:
  1. HCI over time + per-category overlays (time series)
  2. Current verifier statuses (grouped bar by category)
  3. Tool invocation frequency (horizontal bar)
  4. Hook latency distribution (box plot per hook)
  5. LIFESAVER + meta-observer events over time (scatter)
  6. Warm cache ages (bar)
  7. Tool coupling heatmap (matrix)
  8. Rule violation counts (horizontal bar)

Every panel: sortable legend, hover details, interactive zoom. The HTML
embeds all data as JSON + uses plotly.js via CDN.

Usage:
    python3 tools/HME/scripts/build-dashboard.py
    python3 tools/HME/scripts/build-dashboard.py --open  # xdg-open after write
"""
import glob
import json
import os
import subprocess
import sys
import time

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError:
    _HAS_NUMPY = False

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
METRICS_DIR = os.environ.get("METRICS_DIR") or os.path.join(_PROJECT, "output", "metrics")
_METRICS = os.path.join(METRICS_DIR)
_LOG = os.path.join(_PROJECT, "log")
_OUTPUT = os.path.join(_METRICS, "hme-dashboard.html")


def _safe_load(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def _safe_jsonl(path: str) -> list:
    if not os.path.isfile(path):
        return []
    out = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        pass
    return out


def _load_holograph_series() -> dict:
    """Load all holograph snapshots, extract HCI + category scores over time."""
    paths = sorted(glob.glob(os.path.join(_METRICS, "holograph", "holograph-*.json")))
    samples = []
    for p in paths:
        snap = _safe_load(p)
        if not snap:
            continue
        hci_block = snap.get("hci", {})
        captured = snap.get("captured_at", 0)
        if not captured:
            continue
        samples.append({
            "ts": captured,
            "hci": hci_block.get("hci", 0),
            "categories": {
                k: v.get("score", 0) * 100
                for k, v in hci_block.get("categories", {}).items()
            },
        })
    return {"samples": samples}


def _load_current_verifiers() -> dict:
    """Run verify-coherence.py --json to get the current verifier state."""
    script = os.path.join(_PROJECT, "tools", "HME", "scripts", "verify-coherence.py")
    try:
        rc = subprocess.run(
            ["python3", script, "--json"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "PROJECT_ROOT": _PROJECT},
        )
        return json.loads(rc.stdout)
    except Exception as e:
        sys.stderr.write(f"verifier fetch failed: {e}\n")
        return {}


def _aggregate_hook_latency() -> dict:
    """Aggregate log/hme-hook-latency.jsonl into per-hook stats."""
    events = _safe_jsonl(os.path.join(_LOG, "hme-hook-latency.jsonl"))
    by_hook = {}
    for e in events:
        hook = e.get("hook", "?")
        dur = float(e.get("duration_ms", 0))
        by_hook.setdefault(hook, []).append(dur)
    result = {}
    for hook, durs in by_hook.items():
        if not durs:
            continue
        durs_sorted = sorted(durs)
        n = len(durs_sorted)
        result[hook] = {
            "count": n,
            "median": durs_sorted[n // 2],
            "p95": durs_sorted[min(n - 1, int(n * 0.95))],
            "max": durs_sorted[-1],
            "min": durs_sorted[0],
            "all": durs,  # for box plot
        }
    return result


def _collect_data() -> dict:
    return {
        "holograph": _load_holograph_series(),
        "verifiers": _load_current_verifiers(),
        "effectiveness": _safe_load(os.path.join(_METRICS, "hme-tool-effectiveness.json")),
        "trajectory": _safe_load(os.path.join(_METRICS, "hme-trajectory.json")),
        "coupling": _safe_load(os.path.join(_METRICS, "hme-coupling.json")),
        "hci_forecast": _safe_load(os.path.join(_METRICS, "hme-hci-forecast.json")),
        "memetic": _safe_load(os.path.join(_METRICS, "hme-memetic-drift.json")),
        "verifier_coverage": _safe_load(os.path.join(_METRICS, "hme-verifier-coverage.json")),
        "hook_latency": _aggregate_hook_latency(),
        "coherence_log": _safe_jsonl(os.path.join(_METRICS, "hme-coherence.jsonl")),
    }


# HTML template with plotly.js via CDN

_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>HME Dashboard</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>
  body {
    background: #0e0e14;
    color: #cdd6f4;
    font-family: -apple-system, "SF Mono", Menlo, monospace;
    margin: 0;
    padding: 20px;
  }
  h1 { color: #a6e3a1; font-size: 20px; }
  h2 { color: #89b4fa; font-size: 15px; margin-top: 30px; }
  .meta { color: #6c7086; font-size: 12px; }
  .panel {
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 20px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .full { grid-column: 1 / -1; }
  @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
  .kpi-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 20px;
  }
  .kpi {
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 6px;
    padding: 10px 16px;
    min-width: 140px;
  }
  .kpi .label { color: #6c7086; font-size: 11px; text-transform: uppercase; }
  .kpi .value { color: #f9e2af; font-size: 22px; font-weight: 600; }
  .kpi.good .value { color: #a6e3a1; }
  .kpi.warn .value { color: #f9e2af; }
  .kpi.fail .value { color: #f38ba8; }
</style>
</head>
<body>
<h1>HME Dashboard</h1>
<div class="meta">Generated __GENERATED__ · Project root: __PROJECT__</div>
<div id="kpis" class="kpi-row"></div>

<div class="grid">
  <div class="panel full"><div id="hci-series" style="height:380px;"></div></div>
  <div class="panel"><div id="category-radar" style="height:340px;"></div></div>
  <div class="panel"><div id="verifier-bars" style="height:340px;"></div></div>
  <div class="panel"><div id="tool-freq" style="height:360px;"></div></div>
  <div class="panel"><div id="hook-latency" style="height:360px;"></div></div>
  <div class="panel"><div id="coupling-heatmap" style="height:380px;"></div></div>
  <div class="panel"><div id="memetic" style="height:340px;"></div></div>
  <div class="panel full"><div id="coherence-log" style="height:320px;"></div></div>
</div>

<script id="data" type="application/json">__DATA__</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const DARK = {
  paper_bgcolor: '#1e1e2e',
  plot_bgcolor: '#181825',
  font: { color: '#cdd6f4', family: 'SF Mono, monospace', size: 11 },
  margin: { l: 50, r: 20, t: 40, b: 50 },
};

//  KPI row
const verData = D.verifiers || {};
const hci = verData.hci || 0;
const cats = verData.categories || {};
const kpis = document.getElementById('kpis');
function addKpi(label, value, klass) {
  const d = document.createElement('div');
  d.className = 'kpi ' + (klass || '');
  d.innerHTML = '<div class="label">'+label+'</div><div class="value">'+value+'</div>';
  kpis.appendChild(d);
}
addKpi('HCI', hci.toFixed(1), hci >= 95 ? 'good' : hci >= 80 ? 'warn' : 'fail');
addKpi('Verifiers', verData.verifier_count || '?');
addKpi('Categories', Object.keys(cats).length);
const samples = (D.holograph || {}).samples || [];
addKpi('Holographs', samples.length);
const eff = D.effectiveness || {};
addKpi('Sessions', eff.session_count || 0);
addKpi('Hook fires', Object.values(eff.hook_fire_counts || {}).reduce((a,b)=>a+b,0));
addKpi('KB entries', (D.coupling || {}).session_count || '-');
const fc = D.hci_forecast || {};
if (fc.predicted_next_hci !== undefined) addKpi('Next HCI', fc.predicted_next_hci, fc.predicted_next_hci >= 80 ? 'good' : 'warn');

//  HCI time series with per-category overlays
if (samples.length >= 1) {
  const xs = samples.map(s => new Date(s.ts * 1000));
  const traces = [{
    x: xs, y: samples.map(s => s.hci),
    name: 'HCI (aggregate)', mode: 'lines+markers',
    line: { color: '#a6e3a1', width: 3 },
    marker: { size: 7 },
  }];
  const catNames = new Set();
  samples.forEach(s => Object.keys(s.categories || {}).forEach(c => catNames.add(c)));
  const palette = ['#89b4fa', '#f9e2af', '#f38ba8', '#cba6f7', '#94e2d5', '#fab387'];
  let ci = 0;
  for (const cat of catNames) {
    traces.push({
      x: xs, y: samples.map(s => (s.categories || {})[cat] ?? null),
      name: cat, mode: 'lines',
      line: { color: palette[ci % palette.length], width: 1.5, dash: 'dot' },
      visible: 'legendonly',  // overlayable via legend click
    });
    ci++;
  }
  Plotly.newPlot('hci-series', traces, {
    ...DARK, title: 'HCI over time · click legend to overlay categories',
    xaxis: { gridcolor: '#313244' }, yaxis: { range: [0, 105], gridcolor: '#313244' },
  }, {displaylogo: false});
}

//  Current category radar
if (Object.keys(cats).length) {
  const catKeys = Object.keys(cats).sort();
  Plotly.newPlot('category-radar', [{
    type: 'scatterpolar',
    r: catKeys.map(k => cats[k].score * 100),
    theta: catKeys,
    fill: 'toself',
    line: { color: '#89b4fa' },
    fillcolor: 'rgba(137, 180, 250, 0.3)',
  }], {
    ...DARK, title: 'Categories · radar',
    polar: { radialaxis: { range: [0, 100], gridcolor: '#313244' }, bgcolor: '#181825' },
  }, {displaylogo: false});
}

//  Verifier status bars (grouped by category)
const vs = verData.verifiers || {};
if (Object.keys(vs).length) {
  const byCat = {};
  Object.entries(vs).forEach(([name, info]) => {
    const c = info.category || 'other';
    (byCat[c] = byCat[c] || []).push({ name, score: info.score * 100, status: info.status });
  });
  const traces = Object.entries(byCat).map(([cat, items]) => ({
    x: items.map(i => i.name), y: items.map(i => i.score),
    name: cat, type: 'bar',
    text: items.map(i => i.status), textposition: 'outside',
    marker: { color: items.map(i => i.score === 100 ? '#a6e3a1' : i.score >= 80 ? '#f9e2af' : '#f38ba8') },
  }));
  Plotly.newPlot('verifier-bars', traces, {
    ...DARK, title: 'Verifiers · per-verifier score',
    barmode: 'group',
    xaxis: { tickangle: -45, automargin: true },
    yaxis: { range: [0, 115], gridcolor: '#313244' },
  }, {displaylogo: false});
}

//  Tool invocation frequency
const tic = eff.tool_invocation_counts || {};
if (Object.keys(tic).length) {
  const sorted = Object.entries(tic).sort((a,b) => b[1] - a[1]);
  Plotly.newPlot('tool-freq', [{
    type: 'bar', orientation: 'h',
    y: sorted.map(s => s[0]).reverse(),
    x: sorted.map(s => s[1]).reverse(),
    marker: { color: '#89dceb' },
  }], {
    ...DARK, title: 'Tool invocation frequency (all sessions)',
    xaxis: { gridcolor: '#313244' }, yaxis: { gridcolor: '#313244' },
  }, {displaylogo: false});
}

//  Hook latency box plot
const hl = D.hook_latency || {};
if (Object.keys(hl).length) {
  const traces = Object.entries(hl).map(([name, stats]) => ({
    y: stats.all, name, type: 'box', boxpoints: 'outliers',
  }));
  Plotly.newPlot('hook-latency', traces, {
    ...DARK, title: 'Hook latency distribution (ms)',
    yaxis: { type: 'log', gridcolor: '#313244', title: 'ms (log)' },
    xaxis: { tickangle: -45, automargin: true },
    showlegend: false,
  }, {displaylogo: false});
}

//  Coupling matrix heatmap
const cm = (D.coupling || {}).matrix || {};
const nodes = (D.coupling || {}).nodes || [];
if (nodes.length >= 2) {
  const z = nodes.map(a => nodes.map(b => {
    if (a === b) return null;
    const aRow = cm[a] || {}, bRow = cm[b] || {};
    const info = aRow[b] || bRow[a] || {};
    return info.cooccurrence || null;
  }));
  Plotly.newPlot('coupling-heatmap', [{
    type: 'heatmap', z, x: nodes, y: nodes,
    colorscale: 'Viridis', hoverongaps: false,
  }], {
    ...DARK, title: 'Tool pair co-occurrence matrix',
    xaxis: { tickangle: -45, automargin: true },
  }, {displaylogo: false});
}

//  Memetic drift: rule violations
const mv = (D.memetic || {}).violation_counts || {};
if (Object.keys(mv).length) {
  const sorted = Object.entries(mv).sort((a,b) => b[1] - a[1]);
  Plotly.newPlot('memetic', [{
    type: 'bar', orientation: 'h',
    y: sorted.map(s => s[0]).reverse(),
    x: sorted.map(s => s[1]).reverse(),
    marker: { color: sorted.map(s => s[1] >= 3 ? '#f38ba8' : s[1] >= 1 ? '#f9e2af' : '#a6e3a1').reverse() },
  }], {
    ...DARK, title: 'CLAUDE.md rule violations (recent history)',
    xaxis: { gridcolor: '#313244' }, yaxis: { automargin: true },
  }, {displaylogo: false});
}

//  Coherence log scatter over time (historical data, from pre-deprecation)
const ch = D.coherence_log || [];
if (ch.length) {
  const xs = ch.map(e => new Date((e.ts || 0) * 1000));
  Plotly.newPlot('coherence-log', [
    { x: xs, y: ch.map(e => e.coherence), name: 'coherence', mode: 'lines',
      line: { color: '#94e2d5', width: 1.5 }, yaxis: 'y' },
    { x: xs, y: ch.map(e => e.shim_ms || null), name: 'shim ms', mode: 'lines',
      line: { color: '#fab387', width: 1 }, yaxis: 'y2' },
  ], {
    ...DARK, title: 'Coherence + latency (historical)',
    xaxis: { gridcolor: '#313244' },
    yaxis: { title: 'coherence', range: [0, 1.1], gridcolor: '#313244' },
    yaxis2: { title: 'shim ms', overlaying: 'y', side: 'right', gridcolor: '#313244' },
  }, {displaylogo: false});
}
</script>
</body>
</html>
"""


def build() -> int:
    data = _collect_data()
    html = (
        _HTML_TEMPLATE
        .replace("__DATA__", json.dumps(data, default=str))
        .replace("__GENERATED__", time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()))
        .replace("__PROJECT__", _PROJECT)
    )
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        f.write(html)
    size = os.path.getsize(_OUTPUT)
    print(f"Dashboard: {_OUTPUT}")
    print(f"  size: {size:,} bytes")
    print(f"  holograph samples: {len(data['holograph'].get('samples', []))}")
    print(f"  verifiers: {(data['verifiers'] or {}).get('verifier_count', 0)}")
    print(f"  hook-latency hooks: {len(data['hook_latency'])}")
    print(f"  coupling nodes: {(data['coupling'] or {}).get('node_count', 0)}")
    return 0


def main(argv: list) -> int:
    rc = build()
    if rc != 0:
        return rc
    if "--open" in argv:
        try:
            subprocess.Popen(["xdg-open", _OUTPUT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
