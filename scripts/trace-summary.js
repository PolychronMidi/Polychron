// scripts/trace-summary.js
// Summarize output/trace.jsonl into output/trace-summary.json for quick diagnostics.

'use strict';

const fs = require('fs');
const path = require('path');

function parseLine(line, index) {
  try {
    return JSON.parse(line);
  } catch (err) {
    console.warn(`Acceptable warning: trace-summary: skipping invalid JSON at line ${index + 1}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function updateMinMax(stat, value) {
  stat.min = value < stat.min ? value : stat.min;
  stat.max = value > stat.max ? value : stat.max;
  stat.sum += value;
  stat.count++;
}

function finalizeMinMax(stat) {
  return {
    min: stat.count > 0 ? stat.min : null,
    max: stat.count > 0 ? stat.max : null,
    avg: stat.count > 0 ? Number((stat.sum / stat.count).toFixed(4)) : null,
    count: stat.count
  };
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  const pos = (sortedValues.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  const frac = pos - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}

function summarizeTail(values, thresholds) {
  if (!Array.isArray(values) || values.length === 0) {
    return { p90: null, p95: null, exceedanceRate: {} };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const exceedanceRate = {};
  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i];
    let count = 0;
    for (let j = 0; j < values.length; j++) {
      if (values[j] >= t) count++;
    }
    exceedanceRate[t.toFixed(2)] = Number((count / values.length).toFixed(4));
  }
  return {
    p90: Number(percentile(sorted, 0.90).toFixed(4)),
    p95: Number(percentile(sorted, 0.95).toFixed(4)),
    exceedanceRate
  };
}

function summarizeTrace(entries) {
  const byLayer = { L1: 0, L2: 0, other: 0 };
  const regimeCounts = {};
  const playProb = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const stutterProb = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const density = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const tension = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const flicker = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const couplingAbs = {};
  const couplingSeries = {};
  const trustScoreAbs = {};
  const trustWeightAbs = {};
  const stageTimingAgg = {}; // per-stage min/max/avg across all beats
  const BEAT_SETUP_BUDGET_MS = 200; // R9 Evo 5: flag beats where beat-setup exceeds this
  let beatSetupExceeded = 0;

  let firstBeatKey = null;
  let lastBeatKey = null;
  let firstTimeMs = null;
  let lastTimeMs = null;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const layer = typeof e.layer === 'string' ? e.layer : 'other';
    if (layer === 'L1' || layer === 'L2') byLayer[layer]++;
    else byLayer.other++;

    if (firstBeatKey === null && typeof e.beatKey === 'string') firstBeatKey = e.beatKey;
    if (typeof e.beatKey === 'string') lastBeatKey = e.beatKey;

    const timeMs = toNum(e.timeMs, NaN);
    if (Number.isFinite(timeMs)) {
      if (firstTimeMs === null || timeMs < firstTimeMs) firstTimeMs = timeMs;
      if (lastTimeMs === null || timeMs > lastTimeMs) lastTimeMs = timeMs;
    }

    const snap = e.snap && typeof e.snap === 'object' ? e.snap : {};
    const regime = typeof e.regime === 'string' ? e.regime : 'unknown';
    regimeCounts[regime] = (regimeCounts[regime] || 0) + 1;

    updateMinMax(playProb, toNum(snap.playProb, 0));
    updateMinMax(stutterProb, toNum(snap.stutterProb, 0));
    updateMinMax(density, toNum(snap.compositeIntensity !== undefined ? snap.compositeIntensity : snap.currentDensity, 0));
    updateMinMax(tension, toNum(snap.tension, 0));
    updateMinMax(flicker, toNum(snap.flicker, 0));

    const cm = e.coupling && typeof e.coupling === 'object' ? e.coupling : {};
    const couplingKeys = Object.keys(cm);
    for (let j = 0; j < couplingKeys.length; j++) {
      const key = couplingKeys[j];
      const value = Math.abs(toNum(cm[key], 0));
      if (!couplingAbs[key]) couplingAbs[key] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
      if (!couplingSeries[key]) couplingSeries[key] = [];
      updateMinMax(couplingAbs[key], value);
      couplingSeries[key].push(value);
    }

    const trust = e.trust && typeof e.trust === 'object' ? e.trust : {};
    const trustKeys = Object.keys(trust);
    for (let j = 0; j < trustKeys.length; j++) {
      const key = trustKeys[j];
      const entry = trust[key];

      if (entry && typeof entry === 'object') {
        const score = Math.abs(toNum(entry.score, NaN));
        if (Number.isFinite(score)) {
          if (!trustScoreAbs[key]) trustScoreAbs[key] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
          updateMinMax(trustScoreAbs[key], score);
        }

        const weight = Math.abs(toNum(entry.weight, NaN));
        if (Number.isFinite(weight)) {
          if (!trustWeightAbs[key]) trustWeightAbs[key] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
          updateMinMax(trustWeightAbs[key], weight);
        }
      } else {
        const scalar = Math.abs(toNum(entry, NaN));
        if (Number.isFinite(scalar)) {
          if (!trustScoreAbs[key]) trustScoreAbs[key] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
          updateMinMax(trustScoreAbs[key], scalar);
        }
      }
    }

    // Accumulate per-stage timing (processBeat hot-path profile)
    const st = e.stageTiming;
    if (st && typeof st === 'object') {
      const stKeys = Object.keys(st);
      for (let j = 0; j < stKeys.length; j++) {
        const stage = stKeys[j];
        const ms = toNum(st[stage], NaN);
        if (!Number.isFinite(ms)) continue;
        if (!stageTimingAgg[stage]) stageTimingAgg[stage] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
        updateMinMax(stageTimingAgg[stage], ms);
      }
      // R9 Evo 5: count beats where beat-setup exceeds the budget
      const setupMs = toNum(st['beat-setup'], NaN);
      if (Number.isFinite(setupMs) && setupMs > BEAT_SETUP_BUDGET_MS) beatSetupExceeded++;
    }
  }

  const couplingSummary = {};
  const couplingKeys = Object.keys(couplingAbs).sort();
  for (let i = 0; i < couplingKeys.length; i++) {
    const key = couplingKeys[i];
    couplingSummary[key] = finalizeMinMax(couplingAbs[key]);
  }

  const couplingTail = {};
  for (let i = 0; i < couplingKeys.length; i++) {
    const key = couplingKeys[i];
    couplingTail[key] = summarizeTail(couplingSeries[key], [0.50, 0.70, 0.85]);
  }

  const trustScoreSummary = {};
  const trustScoreKeys = Object.keys(trustScoreAbs).sort();
  for (let i = 0; i < trustScoreKeys.length; i++) {
    const key = trustScoreKeys[i];
    trustScoreSummary[key] = finalizeMinMax(trustScoreAbs[key]);
  }

  const trustWeightSummary = {};
  const trustWeightKeys = Object.keys(trustWeightAbs).sort();
  for (let i = 0; i < trustWeightKeys.length; i++) {
    const key = trustWeightKeys[i];
    trustWeightSummary[key] = finalizeMinMax(trustWeightAbs[key]);
  }

  const trustSummary = {};
  const trustKeys = Object.keys(trustScoreSummary).sort();
  for (let i = 0; i < trustKeys.length; i++) {
    const key = trustKeys[i];
    trustSummary[key] = trustScoreSummary[key];
  }

  return {
    generatedAt: new Date().toISOString(),
    beats: {
      totalEntries: entries.length,
      byLayer,
      firstBeatKey,
      lastBeatKey,
      firstTimeMs,
      lastTimeMs,
      spanMs: firstTimeMs !== null && lastTimeMs !== null ? Number((lastTimeMs - firstTimeMs).toFixed(3)) : null
    },
    regimes: regimeCounts,
    conductor: {
      playProb: finalizeMinMax(playProb),
      stutterProb: finalizeMinMax(stutterProb),
      density: finalizeMinMax(density),
      tension: finalizeMinMax(tension),
      flicker: finalizeMinMax(flicker)
    },
    couplingAbs: couplingSummary,
    couplingTail,
    trustScoreAbs: trustScoreSummary,
    trustWeightAbs: trustWeightSummary,
    trustAbs: trustSummary,
    stageTiming: (() => {
      const stKeys = Object.keys(stageTimingAgg);
      if (stKeys.length === 0) return null;
      const result = {};
      for (let i = 0; i < stKeys.length; i++) result[stKeys[i]] = finalizeMinMax(stageTimingAgg[stKeys[i]]);
      return result;
    })(),
    beatSetupBudget: {
      thresholdMs: BEAT_SETUP_BUDGET_MS,
      exceededCount: beatSetupExceeded,
      totalBeats: entries.length,
      exceededRate: entries.length > 0 ? Number((beatSetupExceeded / entries.length).toFixed(4)) : 0
    }
  };
}

function main() {
  const tracePath = path.join(process.cwd(), 'output', 'trace.jsonl');
  const summaryPath = path.join(process.cwd(), 'output', 'trace-summary.json');

  if (!fs.existsSync(tracePath)) {
    console.log('trace-summary: trace file not found, skipping (run with --trace to generate output/trace.jsonl).');
    return;
  }

  const raw = fs.readFileSync(tracePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    console.warn('Acceptable warning: trace-summary: trace.jsonl is empty, skipping.');
    return;
  }

  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const entry = parseLine(lines[i], i);
    if (entry !== null) entries.push(entry);
  }

  if (entries.length === 0) {
    console.warn('Acceptable warning: trace-summary: no valid entries in trace.jsonl, skipping.');
    return;
  }

  const summary = summarizeTrace(entries);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`trace-summary: ${entries.length} entries -> output/trace-summary.json`);
}

main();
