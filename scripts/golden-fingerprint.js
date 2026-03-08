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
//   - Tension arc shape (4-point summary: start, middle, closing, tail)
//   - Trust convergence rate
//   - Regime distribution
//   - Coupling correlation summary
//   - Hotspot migration surface
//   - Telemetry health
//
// Output: metrics/golden-fingerprint.json (current run)
//         metrics/golden-fingerprint.prev.json (previous run, for diff)
//         metrics/fingerprint-comparison.json (comparison results)
//
// Run: node scripts/golden-fingerprint.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const METRICS_DIR = path.join(ROOT, 'metrics');
const COMPOSITION_DIR = path.join(ROOT, 'output');
const FINGERPRINT_PATH = path.join(METRICS_DIR, 'golden-fingerprint.json');
const PREV_PATH = path.join(METRICS_DIR, 'golden-fingerprint.prev.json');
const COMPARISON_PATH = path.join(METRICS_DIR, 'fingerprint-comparison.json');
const TRACE_PATH = path.join(METRICS_DIR, 'trace.jsonl');
const SUMMARY_PATH = path.join(METRICS_DIR, 'trace-summary.json');
const MANIFEST_PATH = path.join(METRICS_DIR, 'system-manifest.json');
const CSV_PATHS = [
  path.join(COMPOSITION_DIR, 'output1.csv'),
  path.join(COMPOSITION_DIR, 'output2.csv')
];

// ---- Tolerance bands for comparison ----
// Each dimension has a tolerance: deviation within this range is "evolved", beyond is "drifted"

const TOLERANCES = {
  pitchEntropyDelta: 0.25,        // absolute entropy units
  densityVarianceDelta: 0.20,     // absolute variance change
  tensionArcDistortion: 0.30,     // normalized arc shape distance
  trustConvergenceDelta: 0.25,    // trust score convergence rate change
  regimeDistributionDelta: 0.20,  // Jensen-Shannon divergence threshold (R9 Evo 6: tightened from 0.30)
  couplingDelta: 0.25,            // mean absolute coupling change
  exceedanceSeverity: 55,         // R63 E2: Broadened from 35 -- ongoing improvement trend was false-flagging as drift
  hotspotMigration: 0.55,
  telemetryHealthDelta: 0.35
};

// ---- Utility functions ----

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getFreshSummary(entries) {
  const summary = loadJSON(SUMMARY_PATH);
  if (!summary || entries.length === 0) return null;
  const totalEntries = summary && summary.beats ? Number(summary.beats.totalEntries) : NaN;
  if (Number.isFinite(totalEntries) && totalEntries !== entries.length) return null;
  return summary;
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

function getLegacyTopPairs(fingerprint) {
  const severity = fingerprint && fingerprint.exceedanceSeverity && typeof fingerprint.exceedanceSeverity === 'object'
    ? fingerprint.exceedanceSeverity
    : {};
  return Object.entries(severity)
    .map(function(entry) { return { pair: entry[0], beats: toNum(entry[1], 0) }; })
    .filter(function(entry) { return entry.beats > 0; })
    .sort(function(a, b) { return b.beats - a.beats; })
    .slice(0, 3);
}

function getExceedanceCompositeView(fingerprint) {
  const total = fingerprint && typeof fingerprint.totalExceedanceBeats === 'number'
    ? fingerprint.totalExceedanceBeats
    : 0;
  const legacyTopPairs = getLegacyTopPairs(fingerprint);
  if (fingerprint && fingerprint.exceedanceComposite) {
    const composite = fingerprint.exceedanceComposite;
    return {
      uniqueBeats: toNum(composite.uniqueBeats, total),
      uniqueRate: toNum(composite.uniqueRate, 0),
      totalPairExceedanceBeats: toNum(composite.totalPairExceedanceBeats, total),
      topPairs: Array.isArray(composite.topPairs) && composite.topPairs.length > 0 ? composite.topPairs : legacyTopPairs
    };
  }
  return {
    uniqueBeats: total,
    uniqueRate: 0,
    totalPairExceedanceBeats: total,
    topPairs: legacyTopPairs
  };
}

function getHotspotMigrationView(fingerprint) {
  if (fingerprint && fingerprint.hotspotMigration) {
    return fingerprint.hotspotMigration;
  }
  const composite = getExceedanceCompositeView(fingerprint);
  const topPairs = Array.isArray(composite.topPairs) ? composite.topPairs : [];
  const top2Total = topPairs.slice(0, 2).reduce(function(sum, entry) {
    return sum + toNum(entry && entry.beats, 0);
  }, 0);
  return {
    topPair: topPairs[0] ? topPairs[0].pair : '',
    topPairs,
    top2Concentration: composite.totalPairExceedanceBeats > 0 ? top2Total / composite.totalPairExceedanceBeats : 0,
    axisShares: {
      density: null,
      tension: null,
      flicker: null,
      entropy: null,
      trust: null,
      phase: null
    }
  };
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
  const summary = getFreshSummary(entries);

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
  const totalNotes = noteCountL1 + noteCountL2;
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

  // Tension arc shape: sample at 25%, 50%, 75%, 90% of composition (R11 Evo 4: added 90% tail)
  const tensions = [];
  for (const e of entries) {
    const snap = e.snap || {};
    const t = toNum(snap.tension, NaN);
    if (Number.isFinite(t)) tensions.push(t);
  }
  const tensionArc = tensions.length >= 4 ? [
    mean(tensions.slice(0, Math.floor(tensions.length * 0.25))),
    mean(tensions.slice(Math.floor(tensions.length * 0.35), Math.floor(tensions.length * 0.65))),
    mean(tensions.slice(Math.floor(tensions.length * 0.75))),
    mean(tensions.slice(Math.floor(tensions.length * 0.90)))
  ] : [0, 0, 0, 0];

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

  // R11 Evo 6: Coupling correlation trend persistence
  const couplingCorrelation = {};
  if (summary && summary.couplingCorrelation) {
    for (const [pair, corr] of Object.entries(summary.couplingCorrelation)) {
      couplingCorrelation[pair] = corr;
    }
  }

  // R39 E4 & E5: Extract Exceedance Severity and Spike Trace Data
  const exceedanceSeverity = {};
  let totalExceedanceBeats = 0;
  if (summary && summary.pairExceedanceBeats) {
    for (const [pair, beats] of Object.entries(summary.pairExceedanceBeats)) {
      if (beats) {
        exceedanceSeverity[pair] = beats;
        totalExceedanceBeats += beats;
      }
    }
  }

  const exceedanceComposite = summary && summary.exceedanceComposite
    ? {
      uniqueBeats: toNum(summary.exceedanceComposite.uniqueBeats, 0),
      uniqueRate: toNum(summary.exceedanceComposite.uniqueRate, 0),
      totalPairExceedanceBeats: toNum(summary.exceedanceComposite.totalPairExceedanceBeats, totalExceedanceBeats),
      topPairs: Array.isArray(summary.exceedanceComposite.topPairs) ? summary.exceedanceComposite.topPairs : []
    }
    : {
      uniqueBeats: totalExceedanceBeats,
      uniqueRate: totalBeats > 0 ? totalExceedanceBeats / totalBeats : 0,
      totalPairExceedanceBeats: totalExceedanceBeats,
      topPairs: Object.entries(exceedanceSeverity)
        .map(function(entry) { return { pair: entry[0], beats: entry[1] }; })
        .sort(function(a, b) { return b.beats - a.beats; })
        .slice(0, 3)
    };

  const axisShares = summary && summary.axisEnergyShare && summary.axisEnergyShare.shares
    ? summary.axisEnergyShare.shares
    : {};
  const hotspotTop2Beats = exceedanceComposite.topPairs.slice(0, 2).reduce(function(sum, entry) {
    return sum + toNum(entry && entry.beats, 0);
  }, 0);
  const hotspotMigration = {
    topPair: exceedanceComposite.topPairs[0] ? exceedanceComposite.topPairs[0].pair : '',
    topPairs: exceedanceComposite.topPairs,
    top2Concentration: exceedanceComposite.totalPairExceedanceBeats > 0
      ? Number((hotspotTop2Beats / exceedanceComposite.totalPairExceedanceBeats).toFixed(4))
      : 0,
    axisShares: {
      density: axisShares.density != null ? Number(toNum(axisShares.density, 0).toFixed(4)) : null,
      tension: axisShares.tension != null ? Number(toNum(axisShares.tension, 0).toFixed(4)) : null,
      flicker: axisShares.flicker != null ? Number(toNum(axisShares.flicker, 0).toFixed(4)) : null,
      entropy: axisShares.entropy != null ? Number(toNum(axisShares.entropy, 0).toFixed(4)) : null,
      trust: axisShares.trust != null ? Number(toNum(axisShares.trust, 0).toFixed(4)) : null,
      phase: axisShares.phase != null ? Number(toNum(axisShares.phase, 0).toFixed(4)) : null
    }
  };
  const uniqueBeatKeys = summary && summary.beats && typeof summary.beats.uniqueBeatKeys === 'number'
    ? summary.beats.uniqueBeatKeys
    : entries.length;
  const spanMs = summary && summary.beats && typeof summary.beats.spanMs === 'number'
    ? summary.beats.spanMs
    : 0;
  const outputLoad = {
    traceEntries: entries.length,
    uniqueBeatKeys,
    spanMs,
    notesPerTraceEntry: entries.length > 0 ? Number((totalNotes / entries.length).toFixed(4)) : 0,
    notesPerUniqueBeat: uniqueBeatKeys > 0 ? Number((totalNotes / uniqueBeatKeys).toFixed(4)) : 0,
    notesPerSecond: spanMs > 0 ? Number((totalNotes / (spanMs / 1000)).toFixed(4)) : 0,
    guard: summary && summary.outputLoadGuard ? summary.outputLoadGuard : null,
    progressIntegrity: summary && summary.progressIntegrity ? summary.progressIntegrity : null
  };
  const telemetryHealth = summary && summary.telemetryHealth
    ? {
      score: toNum(summary.telemetryHealth.score, 0),
      phaseTelemetryPresent: Boolean(summary.telemetryHealth.phaseTelemetryPresent),
      phaseIntegrity: typeof summary.telemetryHealth.phaseIntegrity === 'string' ? summary.telemetryHealth.phaseIntegrity : 'healthy',
      underSeenPairCount: toNum(summary.telemetryHealth.underSeenPairCount, 0),
      maxGap: toNum(summary.telemetryHealth.maxGap, 0)
    }
    : {
      score: 0,
      phaseTelemetryPresent: false,
      phaseIntegrity: 'critical',
      underSeenPairCount: 0,
      maxGap: 0
    };

  return {
    meta: {
      generated: new Date().toISOString(),
      traceEntries: entries.length,
      version: 1
    },
    noteCount: { L1: noteCountL1, L2: noteCountL2, total: totalNotes },
    outputLoad,
    pitchEntropy,
    density: { mean: densityMean, variance: densityVariance },
    tensionArc,
    trustConvergence,
    trustFinal,
    regimeDistribution,
    exceedanceSeverity,
    totalExceedanceBeats,
    exceedanceComposite,
    hotspotMigration,
    telemetryHealth,
    couplingMeans,
    couplingCorrelation,
    activeProfile: (manifest && manifest.config && manifest.config.activeProfile) || 'unknown'
  };
}

// ---- Compare two fingerprints ----

function compareFingerprints(current, previous) {
  const results = [];
  let drifted = 0;

  // R11 Evo 5: Cross-profile comparison mode -- widen tolerances when
  // profiles differ between runs (e.g. explosive -> atmospheric).
  const crossProfile = current.activeProfile !== previous.activeProfile &&
    current.activeProfile !== 'unknown' && previous.activeProfile !== 'unknown';
  const crossProfileScale = crossProfile ? 1.3 : 1.0;

  // Beat counts for exceedance normalization
  const curBeats = current.outputLoad && current.outputLoad.uniqueBeatKeys ? current.outputLoad.uniqueBeatKeys : (current.meta.traceEntries || 1);
  const prevBeats = previous.outputLoad && previous.outputLoad.uniqueBeatKeys ? previous.outputLoad.uniqueBeatKeys : (previous.meta.traceEntries || 1);

  // Pitch entropy
  const pitchDelta = Math.abs(current.pitchEntropy - previous.pitchEntropy);
  const pitchPass = pitchDelta <= TOLERANCES.pitchEntropyDelta * crossProfileScale;
  if (!pitchPass) drifted++;
  results.push({ dimension: 'pitchEntropy', delta: pitchDelta, tolerance: TOLERANCES.pitchEntropyDelta, status: pitchPass ? 'stable' : 'drifted', current: current.pitchEntropy, previous: previous.pitchEntropy });

  // Density variance
  const densVarDelta = Math.abs(current.density.variance - previous.density.variance);
  const densPass = densVarDelta <= TOLERANCES.densityVarianceDelta * crossProfileScale;
  if (!densPass) drifted++;
  results.push({ dimension: 'densityVariance', delta: densVarDelta, tolerance: TOLERANCES.densityVarianceDelta, status: densPass ? 'stable' : 'drifted', current: current.density.variance, previous: previous.density.variance });

  // Tension arc distortion (normalized Euclidean distance) -- R11 Evo 4: supports 4-element arcs
  const arcLen = Math.min(current.tensionArc.length, previous.tensionArc.length);
  let arcDist = 0;
  for (let i = 0; i < arcLen; i++) {
    arcDist += (current.tensionArc[i] - previous.tensionArc[i]) ** 2;
  }
  arcDist = Math.sqrt(arcDist / Math.max(arcLen, 1));
  // R32 E4: Profile-specific tensionArc tolerance. Atmospheric late-ramp vs
  // explosive mid-arch are fundamentally different profile characters, not drift.
  // Cross-profile margin was 0.006 in R31 -- dangerously close to false-positive.
  const PROFILE_TENSION_ARC_TOLERANCE = { explosive: 0.35, atmospheric: 0.35, ambient: 0.25, minimal: 0.25 };
  const effectiveTensionArcTolerance = (PROFILE_TENSION_ARC_TOLERANCE[current.activeProfile] || TOLERANCES.tensionArcDistortion) * crossProfileScale;
  const arcPass = arcDist <= effectiveTensionArcTolerance;
  if (!arcPass) drifted++;
  results.push({ dimension: 'tensionArc', delta: arcDist, tolerance: effectiveTensionArcTolerance, status: arcPass ? 'stable' : 'drifted', current: current.tensionArc, previous: previous.tensionArc });

  // Trust convergence
  const trustDelta = Math.abs(current.trustConvergence - previous.trustConvergence);
  const trustPass = trustDelta <= TOLERANCES.trustConvergenceDelta * crossProfileScale;
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
  // R10 Evo 5: profile-adaptive tolerance — explosive allows more flux, ambient demands stability
  const PROFILE_REGIME_TOLERANCE = { explosive: 0.30, atmospheric: 0.25, ambient: 0.15, minimal: 0.15 };
  const effectiveRegimeTolerance = (PROFILE_REGIME_TOLERANCE[current.activeProfile] || TOLERANCES.regimeDistributionDelta) * crossProfileScale;
  const regimePass = regimeDivergence <= effectiveRegimeTolerance;
  if (!regimePass) drifted++;
  results.push({ dimension: 'regimeDistribution', delta: regimeDivergence, tolerance: effectiveRegimeTolerance, status: regimePass ? 'stable' : 'drifted' });

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
  const couplingPass = couplingDelta <= TOLERANCES.couplingDelta * crossProfileScale;
  if (!couplingPass) drifted++;
  results.push({ dimension: 'coupling', delta: couplingDelta, tolerance: TOLERANCES.couplingDelta * crossProfileScale, status: couplingPass ? 'stable' : 'drifted' });

  // R11 Evo 6: Coupling correlation trend persistence -- detect direction flips between runs
  if (current.couplingCorrelation && previous.couplingCorrelation) {
    const corrPairs = new Set([...Object.keys(current.couplingCorrelation), ...Object.keys(previous.couplingCorrelation)]);
    let flips = 0;
    let totalPairs = 0;
    const flipDetails = [];
    for (const p of corrPairs) {
      const curDir = (current.couplingCorrelation[p] || {}).direction || 'stable';
      const prevDir = (previous.couplingCorrelation[p] || {}).direction || 'stable';
      totalPairs++;
      if (curDir !== prevDir) {
        flips++;
        flipDetails.push({ pair: p, from: prevDir, to: curDir });
      }
    }
    const flipRate = totalPairs > 0 ? flips / totalPairs : 0;
    // Informational dimension -- not counted toward drift verdict
    results.push({ dimension: 'correlationTrend', delta: flipRate, tolerance: 1.0, status: 'stable', flipDetails });
  }

  // R39 E4 & E5: Exceedance Severity
  if (current.totalExceedanceBeats !== undefined && previous.totalExceedanceBeats !== undefined) {
    // R46 E6: Compare a composite of unique exceedance beats and top-pair severity.
    const currentComposite = getExceedanceCompositeView(current);
    const previousComposite = getExceedanceCompositeView(previous);
    const curUnique = currentComposite.uniqueBeats;
    const prevUnique = previousComposite.uniqueBeats;
    const curTop = currentComposite.topPairs[0] ? currentComposite.topPairs[0].beats : current.totalExceedanceBeats;
    const prevTop = previousComposite.topPairs[0] ? previousComposite.topPairs[0].beats : previous.totalExceedanceBeats;

    const normCurrUnique = curUnique * (500 / Math.max(1, curBeats));
    const normPrevUnique = prevUnique * (500 / Math.max(1, prevBeats));
    const normCurrTop = curTop * (500 / Math.max(1, curBeats));
    const normPrevTop = prevTop * (500 / Math.max(1, prevBeats));
    const excDelta = Math.abs(normCurrUnique - normPrevUnique) * 0.65 + Math.abs(normCurrTop - normPrevTop) * 0.35;

    const excPass = excDelta <= TOLERANCES.exceedanceSeverity * crossProfileScale;
    if (!excPass) drifted++;
    results.push({
      dimension: 'exceedanceSeverity (beats)',
      delta: Number(excDelta.toFixed(2)),
      tolerance: TOLERANCES.exceedanceSeverity * crossProfileScale,
      status: excPass ? 'stable' : 'drifted',
      currentTotal: current.totalExceedanceBeats,
      previousTotal: previous.totalExceedanceBeats,
      currentUnique: curUnique,
      previousUnique: prevUnique,
      currentTopPair: currentComposite.topPairs[0] || null,
      previousTopPair: previousComposite.topPairs[0] || null,
      normalizedDelta: true
    });
  }

  const currentHotspot = getHotspotMigrationView(current);
  const previousHotspot = getHotspotMigrationView(previous);
  if (currentHotspot && previousHotspot) {
    const currentPairs = Array.isArray(currentHotspot.topPairs) ? currentHotspot.topPairs.map(function(entry) { return entry.pair; }).filter(Boolean) : [];
    const previousPairs = Array.isArray(previousHotspot.topPairs) ? previousHotspot.topPairs.map(function(entry) { return entry.pair; }).filter(Boolean) : [];
    const union = new Set(currentPairs.concat(previousPairs));
    let intersectionCount = 0;
    for (const pair of union) {
      if (currentPairs.indexOf(pair) !== -1 && previousPairs.indexOf(pair) !== -1) intersectionCount++;
    }
    const pairSetDelta = union.size > 0 ? 1 - intersectionCount / union.size : 0;
    const topPairChanged = currentHotspot.topPair && previousHotspot.topPair && currentHotspot.topPair !== previousHotspot.topPair ? 1 : 0;
    const concentrationDelta = Math.abs(toNum(currentHotspot.top2Concentration, 0) - toNum(previousHotspot.top2Concentration, 0));
    const hotspotAxes = ['density', 'flicker', 'trust', 'phase'];
    let axisDelta = 0;
    let axisCount = 0;
    for (let i = 0; i < hotspotAxes.length; i++) {
      const axis = hotspotAxes[i];
      const currentAxis = currentHotspot.axisShares ? currentHotspot.axisShares[axis] : null;
      const previousAxis = previousHotspot.axisShares ? previousHotspot.axisShares[axis] : null;
      if (currentAxis === null || previousAxis === null || currentAxis === undefined || previousAxis === undefined) continue;
      axisDelta += Math.abs(currentAxis - previousAxis);
      axisCount++;
    }
    axisDelta = axisCount > 0 ? axisDelta / axisCount : 0;
    const hotspotMigrationDelta = topPairChanged * 0.45 + pairSetDelta * 0.25 + concentrationDelta * 0.15 + axisDelta * 0.15;
    const hotspotPass = hotspotMigrationDelta <= TOLERANCES.hotspotMigration * crossProfileScale;
    if (!hotspotPass) drifted++;
    results.push({
      dimension: 'hotspotMigration',
      delta: Number(hotspotMigrationDelta.toFixed(4)),
      tolerance: TOLERANCES.hotspotMigration * crossProfileScale,
      status: hotspotPass ? 'stable' : 'drifted',
      currentTopPair: currentHotspot.topPair,
      previousTopPair: previousHotspot.topPair,
      currentTop2Concentration: Number(toNum(currentHotspot.top2Concentration, 0).toFixed(4)),
      previousTop2Concentration: Number(toNum(previousHotspot.top2Concentration, 0).toFixed(4)),
      pairSetDelta: Number(pairSetDelta.toFixed(4)),
      currentAxisShares: currentHotspot.axisShares,
      previousAxisShares: previousHotspot.axisShares
    });
  }

  const currentTelemetry = current.telemetryHealth || {};
  const previousTelemetry = previous.telemetryHealth || {};
  let telemetryHealthDelta = Math.abs(toNum(currentTelemetry.score, 0) - toNum(previousTelemetry.score, 0));
  if (Boolean(currentTelemetry.phaseTelemetryPresent) !== Boolean(previousTelemetry.phaseTelemetryPresent)) {
    telemetryHealthDelta += 0.25;
  }
  if ((currentTelemetry.phaseIntegrity || 'healthy') !== (previousTelemetry.phaseIntegrity || 'healthy')) {
    telemetryHealthDelta += 0.12;
  }
  const telemetryPass = telemetryHealthDelta <= TOLERANCES.telemetryHealthDelta;
  if (!telemetryPass) drifted++;
  results.push({
    dimension: 'telemetryHealth',
    delta: Number(telemetryHealthDelta.toFixed(4)),
    tolerance: TOLERANCES.telemetryHealthDelta,
    status: telemetryPass ? 'stable' : 'drifted',
    current: currentTelemetry,
    previous: previousTelemetry
  });

  if (crossProfile) {
    results.push({ dimension: 'crossProfileWarning', delta: 0, tolerance: 0, status: 'stable',
      note: 'Profiles differ (' + previous.activeProfile + ' -> ' + current.activeProfile + '); tolerances widened 1.3x' });
  }

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
        // R11 Evo 4: 4-point arc labels
        const labels = ['opening (0-25%)', 'middle (35-65%)', 'closing (75-90%)', 'tail (90-100%)'];
        const shifts = [];
        const arcCount = Math.min(current.tensionArc.length, previous.tensionArc.length);
        for (let i = 0; i < arcCount; i++) {
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
      case 'exceedanceSeverity (beats)': {
        const currentComposite = getExceedanceCompositeView(current);
        const previousComposite = getExceedanceCompositeView(previous);
        const curTopPairs = currentComposite.topPairs;
        const prevTopPairs = previousComposite.topPairs;
        const curDesc = curTopPairs.length > 0
          ? curTopPairs.map(function(item) { return item.pair + ': ' + item.beats; }).join(', ')
          : 'none';
        const prevDesc = prevTopPairs.length > 0
          ? prevTopPairs.map(function(item) { return item.pair + ': ' + item.beats; }).join(', ')
          : 'none';
        explain.cause = 'exceedance hotspots shifted from [' + prevDesc + '] to [' + curDesc + ']';
        explain.uniqueBeats = {
          current: currentComposite.uniqueBeats,
          previous: previousComposite.uniqueBeats
        };
        break;
      }
      case 'hotspotMigration': {
        const currentHotspot = getHotspotMigrationView(current);
        const previousHotspot = getHotspotMigrationView(previous);
        const currentDesc = (currentHotspot.topPairs || []).map(function(entry) { return entry.pair + ': ' + entry.beats; }).join(', ') || 'none';
        const previousDesc = (previousHotspot.topPairs || []).map(function(entry) { return entry.pair + ': ' + entry.beats; }).join(', ') || 'none';
        explain.cause = 'hotspot surface migrated from [' + previousDesc + '] to [' + currentDesc + ']';
        explain.axisShift = {
          current: currentHotspot.axisShares,
          previous: previousHotspot.axisShares
        };
        explain.meaning = 'stress redistributed across hotspot surfaces rather than being removed outright';
        break;
      }
      case 'telemetryHealth': {
        const curTelemetry = current.telemetryHealth || {};
        const prevTelemetry = previous.telemetryHealth || {};
        explain.cause = 'telemetry health shifted from phase=' + (prevTelemetry.phaseIntegrity || 'unknown') + ', underSeen=' + toNum(prevTelemetry.underSeenPairCount, 0) + ' to phase=' + (curTelemetry.phaseIntegrity || 'unknown') + ', underSeen=' + toNum(curTelemetry.underSeenPairCount, 0);
        explain.correlates = 'max reconciliation gap moved ' + toNum(prevTelemetry.maxGap, 0).toFixed(3) + ' -> ' + toNum(curTelemetry.maxGap, 0).toFixed(3);
        explain.meaning = 'observability changed enough to affect how confidently hotspot and phase diagnostics can be trusted';
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

const EXPLAINER_PATH = path.join(METRICS_DIR, 'fingerprint-drift-explainer.json');

function main() {
  // Rotate previous fingerprint
  if (fs.existsSync(FINGERPRINT_PATH)) {
    const prev = fs.readFileSync(FINGERPRINT_PATH, 'utf8');
    fs.writeFileSync(PREV_PATH, prev, 'utf8');
  }

  // Compute current fingerprint
  const fingerprint = computeFingerprint();
  fs.mkdirSync(METRICS_DIR, { recursive: true });
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
      ' (' + comparison.driftedDimensions + '/' + comparison.totalDimensions + ' dimensions shifted) -> metrics/fingerprint-comparison.json'
    );
    if (explainer.explanations.length > 0) {
      console.log('golden-fingerprint: drift explainer -> metrics/fingerprint-drift-explainer.json');
    }

    if (comparison.verdict === 'DRIFTED') {
      console.warn('golden-fingerprint: WARNING - significant character drift detected across ' +
        comparison.driftedDimensions + ' dimensions. Review metrics/fingerprint-comparison.json.');
      console.warn('golden-fingerprint: ' + explainer.narrative);
    }
  } else {
    console.log('golden-fingerprint: first run - baseline established -> metrics/golden-fingerprint.json');
  }
}

main();
