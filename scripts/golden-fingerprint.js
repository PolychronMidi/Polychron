// scripts/golden-fingerprint.js
// Computes statistical fingerprints of composition output for regression detection.
// After each run, compares the current output's character against the previous
// golden fingerprint. Does NOT require exact MIDI matching - tests the statistical
// *character* of the output (distribution shape, not exact notes).
//
// Fingerprint dimensions:
//   - Note count per layer
//   - Pitch distribution entropy
//   - Density variance across beats
//   - Tension arc shape (3-point summary: start, peak, end)
//   - Trust convergence rate
//   - Regime distribution
//   - Coupling correlation summary
//
// Output: output/golden-fingerprint.json (current run)
//         output/golden-fingerprint.prev.json (previous run, for diff)
//         output/fingerprint-comparison.json (comparison results)
//
// Run: node scripts/golden-fingerprint.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const FINGERPRINT_PATH = path.join(OUTPUT_DIR, 'golden-fingerprint.json');
const PREV_PATH = path.join(OUTPUT_DIR, 'golden-fingerprint.prev.json');
const COMPARISON_PATH = path.join(OUTPUT_DIR, 'fingerprint-comparison.json');
const TRACE_PATH = path.join(OUTPUT_DIR, 'trace.jsonl');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'trace-summary.json');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'system-manifest.json');
const CSV_PATHS = [
  path.join(OUTPUT_DIR, 'output1.csv'),
  path.join(OUTPUT_DIR, 'output2.csv')
];

// ---- Tolerance bands for comparison ----
// Each dimension has a tolerance: deviation within this range is "evolved", beyond is "drifted"

const TOLERANCES = {
  noteCountRatio: 0.35,           // 35% note count change
  pitchEntropyDelta: 0.25,        // absolute entropy units
  densityVarianceDelta: 0.20,     // absolute variance change
  tensionArcDistortion: 0.30,     // normalized arc shape distance
  trustConvergenceDelta: 0.25,    // trust score convergence rate change
  regimeDistributionDelta: 0.20,  // Jensen-Shannon divergence threshold (R9 Evo 6: tightened from 0.30)
  couplingDelta: 0.25             // mean absolute coupling change
};

// ---- Utility functions ----

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function entropy(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1);
}

// ---- Parse note_on_c events from MIDI CSV files ----

function parseNotesFromCSV(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const pitches = [];
  for (const line of raw.split(/\r?\n/)) {
    // CSV format: track, tick, event_type, channel, pitch, velocity
    const cols = line.split(',');
    if (cols.length >= 6 && cols[2] && cols[2].trim() === 'note_on_c') {
      const pitch = toNum(cols[4], -1);
      const velocity = toNum(cols[5], 0);
      if (pitch >= 0 && pitch < 128 && velocity > 0) pitches.push(pitch);
    }
  }
  return pitches;
}

// ---- Compute fingerprint from trace data ----

function computeFingerprint() {
  const summary = loadJSON(SUMMARY_PATH);
  const manifest = loadJSON(MANIFEST_PATH);

  // Parse trace entries
  let entries = [];
  if (fs.existsSync(TRACE_PATH)) {
    const raw = fs.readFileSync(TRACE_PATH, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    entries = lines.map(line => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  }

  // Note counts and pitch distribution from output CSV files
  const pitchCounts = new Array(128).fill(0);
  const notesPerLayer = [];
  for (const csvPath of CSV_PATHS) {
    const pitches = parseNotesFromCSV(csvPath);
    notesPerLayer.push(pitches.length);
    for (const p of pitches) pitchCounts[p]++;
  }
  const noteCountL1 = notesPerLayer[0] || 0;
  const noteCountL2 = notesPerLayer[1] || 0;
  const pitchEntropy = entropy(pitchCounts);

  // Density variance across beats
  const densities = [];
  for (const e of entries) {
    const snap = e.snap || {};
    const d = toNum(snap.compositeIntensity || snap.densityMultiplier, NaN);
    if (Number.isFinite(d)) densities.push(d);
  }
  const densityVariance = variance(densities);
  const densityMean = mean(densities);

  // Tension arc shape: sample at 25%, 50%, 75% of composition
  const tensions = [];
  for (const e of entries) {
    const snap = e.snap || {};
    const t = toNum(snap.tension, NaN);
    if (Number.isFinite(t)) tensions.push(t);
  }
  const tensionArc = tensions.length >= 4 ? [
    mean(tensions.slice(0, Math.floor(tensions.length * 0.25))),
    mean(tensions.slice(Math.floor(tensions.length * 0.35), Math.floor(tensions.length * 0.65))),
    mean(tensions.slice(Math.floor(tensions.length * 0.75)))
  ] : [0, 0, 0];

  // Trust convergence: average final trust scores
  const trustFinal = {};
  if (summary && summary.trustAbs) {
    for (const [key, stat] of Object.entries(summary.trustAbs)) {
      trustFinal[key] = toNum(stat.avg, 0);
    }
  }
  const trustConvergence = Object.keys(trustFinal).length > 0
    ? mean(Object.values(trustFinal))
    : 0;

  // Regime distribution
  const regimeDistribution = {};
  const totalBeats = entries.length || 1;
  if (summary && summary.regimes) {
    for (const [regime, count] of Object.entries(summary.regimes)) {
      regimeDistribution[regime] = toNum(count, 0) / totalBeats;
    }
  }

  // Coupling summary
  const couplingMeans = {};
  if (summary && summary.couplingAbs) {
    for (const [pair, stat] of Object.entries(summary.couplingAbs)) {
      couplingMeans[pair] = toNum(stat.avg, 0);
    }
  }

  return {
    meta: {
      generated: new Date().toISOString(),
      traceEntries: entries.length,
      version: 1
    },
    noteCount: { L1: noteCountL1, L2: noteCountL2, total: noteCountL1 + noteCountL2 },
    pitchEntropy,
    density: { mean: densityMean, variance: densityVariance },
    tensionArc,
    trustConvergence,
    trustFinal,
    regimeDistribution,
    couplingMeans
  };
}

// ---- Compare two fingerprints ----

function compareFingerprints(current, previous) {
  const results = [];
  let drifted = 0;

  // Note count ratio
  const prevTotal = previous.noteCount.total || 1;
  const noteRatio = Math.abs(current.noteCount.total - previous.noteCount.total) / prevTotal;
  const notePass = noteRatio <= TOLERANCES.noteCountRatio;
  if (!notePass) drifted++;
  results.push({ dimension: 'noteCount', delta: noteRatio, tolerance: TOLERANCES.noteCountRatio, status: notePass ? 'stable' : 'drifted', current: current.noteCount.total, previous: previous.noteCount.total });

  // Pitch entropy
  const pitchDelta = Math.abs(current.pitchEntropy - previous.pitchEntropy);
  const pitchPass = pitchDelta <= TOLERANCES.pitchEntropyDelta;
  if (!pitchPass) drifted++;
  results.push({ dimension: 'pitchEntropy', delta: pitchDelta, tolerance: TOLERANCES.pitchEntropyDelta, status: pitchPass ? 'stable' : 'drifted', current: current.pitchEntropy, previous: previous.pitchEntropy });

  // Density variance
  const densVarDelta = Math.abs(current.density.variance - previous.density.variance);
  const densPass = densVarDelta <= TOLERANCES.densityVarianceDelta;
  if (!densPass) drifted++;
  results.push({ dimension: 'densityVariance', delta: densVarDelta, tolerance: TOLERANCES.densityVarianceDelta, status: densPass ? 'stable' : 'drifted', current: current.density.variance, previous: previous.density.variance });

  // Tension arc distortion (normalized Euclidean distance)
  let arcDist = 0;
  for (let i = 0; i < 3; i++) {
    arcDist += (current.tensionArc[i] - previous.tensionArc[i]) ** 2;
  }
  arcDist = Math.sqrt(arcDist / 3);
  const arcPass = arcDist <= TOLERANCES.tensionArcDistortion;
  if (!arcPass) drifted++;
  results.push({ dimension: 'tensionArc', delta: arcDist, tolerance: TOLERANCES.tensionArcDistortion, status: arcPass ? 'stable' : 'drifted', current: current.tensionArc, previous: previous.tensionArc });

  // Trust convergence
  const trustDelta = Math.abs(current.trustConvergence - previous.trustConvergence);
  const trustPass = trustDelta <= TOLERANCES.trustConvergenceDelta;
  if (!trustPass) drifted++;
  results.push({ dimension: 'trustConvergence', delta: trustDelta, tolerance: TOLERANCES.trustConvergenceDelta, status: trustPass ? 'stable' : 'drifted', current: current.trustConvergence, previous: previous.trustConvergence });

  // Regime distribution (simplified divergence)
  const allRegimes = new Set([...Object.keys(current.regimeDistribution), ...Object.keys(previous.regimeDistribution)]);
  let regimeDivergence = 0;
  for (const r of allRegimes) {
    const p = current.regimeDistribution[r] || 0;
    const q = previous.regimeDistribution[r] || 0;
    regimeDivergence += Math.abs(p - q);
  }
  regimeDivergence /= Math.max(allRegimes.size, 1);
  const regimePass = regimeDivergence <= TOLERANCES.regimeDistributionDelta;
  if (!regimePass) drifted++;
  results.push({ dimension: 'regimeDistribution', delta: regimeDivergence, tolerance: TOLERANCES.regimeDistributionDelta, status: regimePass ? 'stable' : 'drifted' });

  // Coupling means
  const allPairs = new Set([...Object.keys(current.couplingMeans), ...Object.keys(previous.couplingMeans)]);
  let couplingDelta = 0;
  let couplingCount = 0;
  for (const p of allPairs) {
    const c1 = current.couplingMeans[p] || 0;
    const c2 = previous.couplingMeans[p] || 0;
    couplingDelta += Math.abs(c1 - c2);
    couplingCount++;
  }
  couplingDelta = couplingCount > 0 ? couplingDelta / couplingCount : 0;
  const couplingPass = couplingDelta <= TOLERANCES.couplingDelta;
  if (!couplingPass) drifted++;
  results.push({ dimension: 'coupling', delta: couplingDelta, tolerance: TOLERANCES.couplingDelta, status: couplingPass ? 'stable' : 'drifted' });

  const verdict = drifted === 0 ? 'STABLE' : drifted <= 2 ? 'EVOLVED' : 'DRIFTED';

  return {
    meta: { generated: new Date().toISOString(), currentRun: current.meta.generated, previousRun: previous.meta.generated },
    verdict,
    driftedDimensions: drifted,
    totalDimensions: results.length,
    tolerances: TOLERANCES,
    dimensions: results
  };
}

// ---- Drift Explainer ----
// When dimensions shift, correlate the change to structural causes in the trace data

function explainDrift(comparison, current, previous) {
  const explanations = [];

  for (const dim of comparison.dimensions) {
    if (dim.status === 'stable') continue;

    const explain = { dimension: dim.dimension, delta: dim.delta, tolerance: dim.tolerance };

    switch (dim.dimension) {
      case 'noteCount': {
        const ratio = current.noteCount.total / Math.max(1, previous.noteCount.total);
        const direction = ratio > 1 ? 'more' : 'fewer';
        explain.cause = `${direction} notes emitted (${previous.noteCount.total} -> ${current.noteCount.total}, ${(Math.abs(ratio - 1) * 100).toFixed(1)}% change)`;
        // Correlate with density
        if (current.density.mean !== undefined && previous.density.mean !== undefined) {
          const densityChange = current.density.mean - previous.density.mean;
          if (Math.abs(densityChange) > 0.05) {
            explain.correlates = `density mean shifted ${densityChange > 0 ? 'up' : 'down'} by ${Math.abs(densityChange).toFixed(3)}`;
          }
        }
        // Check layer balance
        const prevBalance = previous.noteCount.L1 / Math.max(1, previous.noteCount.total);
        const currBalance = current.noteCount.L1 / Math.max(1, current.noteCount.total);
        if (Math.abs(prevBalance - currBalance) > 0.1) {
          explain.layerShift = `L1/L2 balance shifted: ${(prevBalance * 100).toFixed(0)}%/${((1 - prevBalance) * 100).toFixed(0)}% -> ${(currBalance * 100).toFixed(0)}%/${((1 - currBalance) * 100).toFixed(0)}%`;
        }
        break;
      }
      case 'pitchEntropy': {
        const direction = current.pitchEntropy > previous.pitchEntropy ? 'increased' : 'decreased';
        explain.cause = `pitch diversity ${direction} (${previous.pitchEntropy.toFixed(3)} -> ${current.pitchEntropy.toFixed(3)})`;
        explain.meaning = current.pitchEntropy > previous.pitchEntropy
          ? 'composition uses a wider spread of pitch classes (more chromatic/exploratory)'
          : 'composition concentrates on fewer pitch classes (more tonal/focused)';
        break;
      }
      case 'densityVariance': {
        const direction = current.density.variance > previous.density.variance ? 'increased' : 'decreased';
        explain.cause = `density variance ${direction} (${previous.density.variance.toFixed(4)} -> ${current.density.variance.toFixed(4)})`;
        explain.meaning = current.density.variance > previous.density.variance
          ? 'density fluctuates more across beats (more dynamic contrast)'
          : 'density is more uniform across beats (flatter dynamic profile)';
        break;
      }
      case 'tensionArc': {
        const labels = ['opening (0-25%)', 'middle (35-65%)', 'closing (75-100%)'];
        const shifts = [];
        for (let i = 0; i < 3; i++) {
          const d = current.tensionArc[i] - previous.tensionArc[i];
          if (Math.abs(d) > 0.05) {
            shifts.push(`${labels[i]}: ${d > 0 ? '+' : ''}${d.toFixed(3)}`);
          }
        }
        explain.cause = shifts.length > 0 ? `tension arc reshaped: ${shifts.join('; ')}` : 'tension arc shape changed subtly across all phases';
        break;
      }
      case 'trustConvergence': {
        const direction = current.trustConvergence > previous.trustConvergence ? 'higher' : 'lower';
        explain.cause = `average trust convergence ${direction} (${previous.trustConvergence.toFixed(3)} -> ${current.trustConvergence.toFixed(3)})`;
        // Find which trust modules shifted most
        const trustShifts = [];
        const allKeys = new Set([...Object.keys(current.trustFinal || {}), ...Object.keys(previous.trustFinal || {})]);
        for (const key of allKeys) {
          const c = (current.trustFinal || {})[key] || 0;
          const p = (previous.trustFinal || {})[key] || 0;
          if (Math.abs(c - p) > 0.1) {
            trustShifts.push(`${key}: ${p.toFixed(2)} -> ${c.toFixed(2)}`);
          }
        }
        if (trustShifts.length > 0) {
          explain.modulesShifted = trustShifts;
        }
        break;
      }
      case 'regimeDistribution': {
        const shifts = [];
        const allRegimes = new Set([...Object.keys(current.regimeDistribution), ...Object.keys(previous.regimeDistribution)]);
        for (const r of allRegimes) {
          const c = current.regimeDistribution[r] || 0;
          const p = previous.regimeDistribution[r] || 0;
          if (Math.abs(c - p) > 0.05) {
            shifts.push(`${r}: ${(p * 100).toFixed(1)}% -> ${(c * 100).toFixed(1)}%`);
          }
        }
        explain.cause = shifts.length > 0 ? `regime balance shifted: ${shifts.join('; ')}` : 'subtle regime rebalancing';
        break;
      }
      case 'coupling': {
        explain.cause = `mean coupling deviation: ${dim.delta.toFixed(4)}`;
        break;
      }
      default:
        explain.cause = 'unknown dimension';
    }

    explanations.push(explain);
  }

  // Overall narrative
  let narrative = '';
  if (comparison.verdict === 'STABLE') {
    narrative = 'The composition character is statistically stable. No significant drift detected.';
  } else if (comparison.verdict === 'EVOLVED') {
    narrative = 'The composition has evolved in ' + comparison.driftedDimensions + ' dimension(s). ' +
      'This is within normal creative variation range. ' +
      explanations.map(e => e.cause).join('. ') + '.';
  } else {
    narrative = 'WARNING: Significant character drift across ' + comparison.driftedDimensions + ' dimensions. ' +
      'This may indicate a regression or fundamental parameter change. ' +
      explanations.map(e => e.cause).join('. ') + '.';
  }

  return {
    meta: { generated: new Date().toISOString(), verdict: comparison.verdict },
    narrative,
    explanations
  };
}

const EXPLAINER_PATH = path.join(OUTPUT_DIR, 'fingerprint-drift-explainer.json');

function main() {
  // Rotate previous fingerprint
  if (fs.existsSync(FINGERPRINT_PATH)) {
    const prev = fs.readFileSync(FINGERPRINT_PATH, 'utf8');
    fs.writeFileSync(PREV_PATH, prev, 'utf8');
  }

  // Compute current fingerprint
  const fingerprint = computeFingerprint();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(FINGERPRINT_PATH, JSON.stringify(fingerprint, null, 2), 'utf8');

  // Compare with previous if it exists
  const previous = loadJSON(PREV_PATH);
  if (previous && previous.meta && previous.meta.version === 1) {
    const comparison = compareFingerprints(fingerprint, previous);
    fs.writeFileSync(COMPARISON_PATH, JSON.stringify(comparison, null, 2), 'utf8');

    // Generate drift explanation
    const explainer = explainDrift(comparison, fingerprint, previous);
    fs.writeFileSync(EXPLAINER_PATH, JSON.stringify(explainer, null, 2), 'utf8');

    const symbol = comparison.verdict === 'STABLE' ? 'STABLE' :
                   comparison.verdict === 'EVOLVED' ? 'EVOLVED' : 'DRIFTED';
    console.log(
      'golden-fingerprint: ' + symbol +
      ' (' + comparison.driftedDimensions + '/' + comparison.totalDimensions + ' dimensions shifted) -> output/fingerprint-comparison.json'
    );
    if (explainer.explanations.length > 0) {
      console.log('golden-fingerprint: drift explainer -> output/fingerprint-drift-explainer.json');
    }

    if (comparison.verdict === 'DRIFTED') {
      console.warn('golden-fingerprint: WARNING - significant character drift detected across ' +
        comparison.driftedDimensions + ' dimensions. Review output/fingerprint-comparison.json.');
      console.warn('golden-fingerprint: ' + explainer.narrative);
    }
  } else {
    console.log('golden-fingerprint: first run - baseline established -> output/golden-fingerprint.json');
  }
}

main();
