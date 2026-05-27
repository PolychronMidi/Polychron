// Phase 5.1 trajectory: linear trend over last-20-round perceptual signals;
// verdict GROWING/PLATEAU/DECLINING. Variance = exploration-surprise proxy.
// Output: metrics/hme-trajectory.json. Surfaced via status(mode='trajectory').

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJson, loadJsonl, clamp, metricPath } = require('./utils');
const projectAdapter = require('../../../proxy/project_adapter');

const MUSICAL = metricPath('hme-musical-correlation.json');
const OUT = metricPath('hme-trajectory.json');

const WINDOW = 20;
const MIN_ROUNDS = 5;
// Normalized slopes: we compute slope per round (x = round index). Thresholds
const THRESHOLDS = {
  perceptual_complexity_avg: 0.001, // was 0.005
  clap_tension: 0.001,              // was 0.005
  encodec_entropy_avg: 0.005,       // was 0.02
};

// Per-signal voting weight. clap_tension promoted to PRIMARY: it's the
const WEIGHTS = {
  perceptual_complexity_avg: 0.5,
  clap_tension: 2.0,
  encodec_entropy_avg: 0.5,
};


function linregress(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0, variance: 0 };
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    den += dx * dx;
    sq += dy * dy;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const variance = sq / n;
  return { slope, intercept, variance };
}

function classify(slope, threshold) {
  if (slope >= threshold) return 'GROWING';
  if (slope <= -threshold) return 'DECLINING';
  return 'PLATEAU';
}

function rollupVerdict(perSignal) {
  const counts = { GROWING: 0, PLATEAU: 0, DECLINING: 0 };
  let totalWeight = 0;
  for (const [key, s] of Object.entries(perSignal)) {
    const verdict = s && s.verdict;
    if (!verdict || verdict === 'INSUFFICIENT_DATA') continue;
    const w = typeof WEIGHTS[key] === 'number' ? WEIGHTS[key] : 1.0;
    counts[verdict] = (counts[verdict] || 0) + w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 'INSUFFICIENT_DATA';
  // Weighted majority; tie -> PLATEAU (conservative).
  let best = 'PLATEAU';
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

function main() {
  const cfg = projectAdapter.loadAdapter(ROOT);
  if (!projectAdapter.hasCapability('perceptual_analysis', cfg)) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({
      skipped: true,
      skipped_reason: 'adapter capability perceptual_analysis=false',
      generated: new Date().toISOString(),
    }, null, 2) + '\n');
    console.log('SKIPPED -- adapter capability perceptual_analysis=false');
    return;
  }
  const musical = loadJson(MUSICAL);
  const history = (musical && Array.isArray(musical.history)) ? musical.history : [];
  const window = history.slice(-WINDOW);

  const meta = {
    script: 'compute-compositional-trajectory.js',
    timestamp: new Date().toISOString(),
    window: WINDOW,
    rounds_used: window.length,
  };

  if (window.length < MIN_ROUNDS) {
    const report = {
      meta,
      verdict: 'INSUFFICIENT_DATA',
      reason: `need >=${MIN_ROUNDS} rounds, have ${window.length}`,
      signals: {},
      history: [],
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    console.log(
      `compute-compositional-trajectory: INSUFFICIENT_DATA ` +
        `(${window.length}/${MIN_ROUNDS} rounds)`,
    );
    return;
  }

  const signalKeys = Object.keys(THRESHOLDS);
  const signals = {};
  for (const key of signalKeys) {
    const series = window
      .map((s) => s[key])
      .filter((v) => typeof v === 'number');
    if (series.length < 2) {
      signals[key] = {
        n: series.length,
        slope: null,
        intercept: null,
        variance: null,
        verdict: 'INSUFFICIENT_DATA',
      };
      continue;
    }
    const { slope, intercept, variance } = linregress(series);
    signals[key] = {
      n: series.length,
      slope: Number(slope.toFixed(5)),
      intercept: Number(intercept.toFixed(5)),
      variance: Number(variance.toFixed(5)),
      range: [Math.min(...series), Math.max(...series)],
      verdict: classify(slope, THRESHOLDS[key]),
    };
  }

  const verdict = rollupVerdict(signals);

  // Append the per-round verdict to the history (capped at 60)
  const prev = loadJson(OUT);
  const prevHistory = Array.isArray(prev && prev.history) ? prev.history : [];
  const newHistory = prevHistory.concat([{
    timestamp: meta.timestamp,
    verdict,
    signals: Object.fromEntries(
      Object.entries(signals).map(([k, v]) => [k, { slope: v.slope, verdict: v.verdict }]),
    ),
  }]).slice(-60);

  const report = {
    meta,
    verdict,
    signals,
    history: newHistory,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  const bits = Object.entries(signals)
    .map(([k, v]) => `${k.split('_')[0]}=${v.verdict}(${v.slope !== null ? v.slope.toFixed(4) : '?'})`)
    .join('  ');
  console.log(`compute-compositional-trajectory: ${verdict}  [${bits}]`);
}

main();
