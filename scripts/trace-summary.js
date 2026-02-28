// scripts/trace-summary.js
// Summarize output/trace.jsonl into output/trace-summary.json for quick diagnostics.

'use strict';

const fs = require('fs');
const path = require('path');

function parseLine(line, index) {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new Error(`trace-summary: invalid JSON at line ${index + 1}: ${err && err.message ? err.message : err}`);
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

function summarizeTrace(entries) {
  const byLayer = { L1: 0, L2: 0, other: 0 };
  const regimeCounts = {};
  const playProb = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const stutterProb = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const density = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const tension = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const flicker = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const couplingAbs = {};
  const trustAbs = {};

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
      updateMinMax(couplingAbs[key], value);
    }

    const trust = e.trust && typeof e.trust === 'object' ? e.trust : {};
    const trustKeys = Object.keys(trust);
    for (let j = 0; j < trustKeys.length; j++) {
      const key = trustKeys[j];
      const value = Math.abs(toNum(trust[key], 0));
      if (!trustAbs[key]) trustAbs[key] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
      updateMinMax(trustAbs[key], value);
    }
  }

  const couplingSummary = {};
  const couplingKeys = Object.keys(couplingAbs).sort();
  for (let i = 0; i < couplingKeys.length; i++) {
    const key = couplingKeys[i];
    couplingSummary[key] = finalizeMinMax(couplingAbs[key]);
  }

  const trustSummary = {};
  const trustKeys = Object.keys(trustAbs).sort();
  for (let i = 0; i < trustKeys.length; i++) {
    const key = trustKeys[i];
    trustSummary[key] = finalizeMinMax(trustAbs[key]);
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
    trustAbs: trustSummary
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
    throw new Error('trace-summary: trace.jsonl is empty');
  }

  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    entries.push(parseLine(lines[i], i));
  }

  const summary = summarizeTrace(entries);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`trace-summary: ${entries.length} entries -> output/trace-summary.json`);
}

main();
