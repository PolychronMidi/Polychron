// scripts/pipeline/compute-compositional-trajectory.js
//
// Phase 5.1 — cross-round compositional trajectory.
//
// Fits a linear trend to the last 20 rounds of perceptual signals and
// reports whether the music is GROWING, on a PLATEAU, or DECLINING.
// Reads `metrics/hme-musical-correlation.json` (which the Phase 4.1
// script maintains as rolling history) and produces a per-round
// trajectory snapshot keyed by signal.
//
// Variance is tracked alongside slope as a "surprise" proxy — a
// composition with high variance is still exploring; zero variance
// means it's locked into a single mode.
//
// Output: metrics/hme-trajectory.json
//   {
//     meta: {window, rounds_used},
//     signals: {
//       perceptual_complexity_avg: {slope, intercept, variance, verdict},
//       clap_tension:              {...},
//       encodec_entropy_avg:       {...}
//     },
//     verdict: GROWING | PLATEAU | DECLINING | INSUFFICIENT_DATA,
//     history: [ per-round overall verdict ]
//   }
//
// Surfaced via status(mode='trajectory').

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MUSICAL = path.join(ROOT, 'metrics', 'hme-musical-correlation.json');
const OUT = path.join(ROOT, 'metrics', 'hme-trajectory.json');

const WINDOW = 20;
const MIN_ROUNDS = 5;
// Normalized slopes: we compute slope per round (x = round index). Thresholds
// are tuned for each signal's approximate scale. EnCodec entropy is ~5-9,
// complexity and clap tension are 0..1. Thresholds are small fractions of
// the signal range per round.
const THRESHOLDS = {
  perceptual_complexity_avg: 0.005, // 0.5% of [0,1] per round
  clap_tension: 0.005,
  encodec_entropy_avg: 0.02,        // ~0.3% of a 6-point range per round
};

function loadJsonMaybe(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_e) { return null; }
}

function linregress(ys) {
  // Simple OLS: x = [0, 1, 2, ...]
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
  const votes = Object.values(perSignal)
    .map((s) => s.verdict)
    .filter((v) => v && v !== 'INSUFFICIENT_DATA');
  if (votes.length === 0) return 'INSUFFICIENT_DATA';
  const counts = { GROWING: 0, PLATEAU: 0, DECLINING: 0 };
  for (const v of votes) counts[v] = (counts[v] || 0) + 1;
  // Simple majority; tie → PLATEAU (conservative)
  let best = 'PLATEAU';
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

function main() {
  const musical = loadJsonMaybe(MUSICAL);
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
      reason: `need ≥${MIN_ROUNDS} rounds, have ${window.length}`,
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
  const prev = loadJsonMaybe(OUT);
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
