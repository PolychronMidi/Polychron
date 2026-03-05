// scripts/trace-summary.js
// Summarize metrics/trace.jsonl into metrics/trace-summary.json for quick diagnostics.

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
  const beatSetupSpikeIndices = []; // R10 Evo 3: record which beats exceeded the budget
  const couplingRawSeries = {}; // R10 Evo 6: signed coupling values for Pearson correlation

  // R17 Evo 6: Regime transition depth tracking
  let lastRegime = null;
  let currentCoherentStreak = 0;
  let maxConsecutiveCoherent = 0;
  let regimeTransitionCount = 0;

  let firstBeatKey = null;
  let lastBeatKey = null;
  let firstTimeMs = null;
  let lastTimeMs = null;
  // R34 E6: Transition readiness accumulators (per-beat gap + velocity tracking)
  let readinessGapSum = 0;
  let readinessGapMin = Infinity;
  let readinessGapMax = -Infinity;
  let readinessVelocityBlockedBeats = 0;
  let readinessBeats = 0;
  let readinessLastScale = null;
  // R35 E5: Exploring-block diagnostic accumulators
  const exploringBlockCounts = { velocity: 0, dimension: 0, coupling: 0, none: 0 };
  // R35 E6: Per-pair exceedance beat tracking (beats above 0.85)
  const pairExceedanceBeats = {};
  // R36 E4: Raw regime counts (cumulative from classifier, grab last beat)
  let rawRegimeCounts = null;

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

    // R17 Evo 6: Track consecutive coherent streaks and regime transitions
    if (lastRegime !== null && regime !== lastRegime) regimeTransitionCount++;
    // R34 E6: Accumulate transition readiness metrics from per-beat data
    if (e.transitionReadiness && typeof e.transitionReadiness === 'object') {
      const tr = e.transitionReadiness;
      if (typeof tr.gap === 'number' && Number.isFinite(tr.gap)) {
        readinessGapSum += tr.gap;
        if (tr.gap < readinessGapMin) readinessGapMin = tr.gap;
        if (tr.gap > readinessGapMax) readinessGapMax = tr.gap;
        readinessBeats++;
        if (tr.velocityBlocked) readinessVelocityBlockedBeats++;
        if (typeof tr.thresholdScale === 'number') readinessLastScale = tr.thresholdScale;
      }
      // R35 E5: Accumulate exploring-block diagnostic
      if (typeof tr.exploringBlock === 'string' && exploringBlockCounts[tr.exploringBlock] !== undefined) {
        exploringBlockCounts[tr.exploringBlock]++;
      }
      // R36 E4: Grab cumulative raw regime counts (last beat wins)
      if (tr.rawRegimeCounts && typeof tr.rawRegimeCounts === 'object') {
        rawRegimeCounts = tr.rawRegimeCounts;
      }
    }
    if (regime === 'coherent') {
      currentCoherentStreak++;
      if (currentCoherentStreak > maxConsecutiveCoherent) maxConsecutiveCoherent = currentCoherentStreak;
    } else {
      currentCoherentStreak = 0;
    }
    lastRegime = regime;

    updateMinMax(playProb, toNum(snap.playProb, 0));
    updateMinMax(stutterProb, toNum(snap.stutterProb, 0));
    updateMinMax(density, toNum(snap.compositeIntensity !== undefined ? snap.compositeIntensity : snap.currentDensity, 0));
    updateMinMax(tension, toNum(snap.tension, 0));
    updateMinMax(flicker, toNum(snap.flicker, 0));

    const cm = e.coupling && typeof e.coupling === 'object' ? e.coupling : {};
    const couplingKeys = Object.keys(cm);
    for (let j = 0; j < couplingKeys.length; j++) {
      const key = couplingKeys[j];
      const raw = toNum(cm[key], 0);
      const value = Math.abs(raw);
      if (!couplingAbs[key]) couplingAbs[key] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
      if (!couplingSeries[key]) couplingSeries[key] = [];
      if (!couplingRawSeries[key]) couplingRawSeries[key] = [];
      updateMinMax(couplingAbs[key], value);
      couplingSeries[key].push(value);
      couplingRawSeries[key].push(raw);
      // R35 E6: Track beats where |r| > 0.85 per pair
      if (value > 0.85) {
        pairExceedanceBeats[key] = (pairExceedanceBeats[key] || 0) + 1;
      }
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
      if (Number.isFinite(setupMs) && setupMs > BEAT_SETUP_BUDGET_MS) {
        beatSetupExceeded++;
        // R10 Evo 3: record index and timing of spike beats
        // R16 Evo 6: include per-stage timing breakdown for spike diagnosis
        const stages = {};
        for (let k = 0; k < stKeys.length; k++) {
          const stageMs = toNum(st[stKeys[k]], NaN);
          if (Number.isFinite(stageMs)) stages[stKeys[k]] = Number(stageMs.toFixed(4));
        }
        beatSetupSpikeIndices.push({ index: i, ms: Number(setupMs.toFixed(4)), stages });
      }
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

  // R10 Evo 4: coupling hotspot detection (pairs with p95 > 0.70)
  const couplingHotspots = [];
  for (let i = 0; i < couplingKeys.length; i++) {
    const key = couplingKeys[i];
    const tail = couplingTail[key];
    if (tail && tail.p95 !== null && tail.p95 > 0.70) {
      couplingHotspots.push({ pair: key, p95: tail.p95, avg: couplingSummary[key].avg });
    }
  }

  // R10 Evo 6: Pearson correlation direction for each coupling pair
  const couplingCorrelation = {};
  for (let i = 0; i < couplingKeys.length; i++) {
    const key = couplingKeys[i];
    const raw = couplingRawSeries[key];
    if (!raw || raw.length < 2) continue;
    const n = raw.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    // Correlate coupling value against beat index (temporal trend)
    for (let j = 0; j < n; j++) {
      sumX += j;
      sumY += raw[j];
      sumXY += j * raw[j];
      sumX2 += j * j;
      sumY2 += raw[j] * raw[j];
    }
    const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const r = denom > 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const meanVal = sumY / n;
    couplingCorrelation[key] = {
      pearsonR: Number(r.toFixed(4)),
      meanSigned: Number(meanVal.toFixed(4)),
      direction: r > 0.3 ? 'increasing' : r < -0.3 ? 'decreasing' : 'stable'
    };
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

  // R18 E5: Extract adaptive coupling target drift from the last trace entry.
  // pipelineCouplingManager writes couplingTargets per beat; we only need the
  // final state to diagnose whether coupling surges are target-drift-driven.
  // R19 E2: Also extract rawRollingAbsCorr for regime-transparent comparison.
  let adaptiveTargets = null;
  let axisCouplingTotals = null;
  let couplingHomeostasisState = null;
  // R27 E4: Per-axis energy share for axis-level redistribution detection
  let axisEnergyShare = null;
  // R27 E2: Coherence gate + floor dampening state for anti-redistribution analysis
  let couplingGates = null;
  // R32 E5: Axis energy equilibrator per-regime telemetry
  let axisEnergyEquilibratorState = null;
  // R28 E1: Enhanced extraction - prefer the last entry where ALL monitored
  // axes have non-zero values. Phase pairs may have null correlations on the
  // very last beat (producing phase=0 in axisCouplingTotals and axisEnergyShare).
  // Fall back to any last-available entry if no fully-populated entry exists.
  let axisCouplingTotalsBest = null;
  let axisEnergyShareBest = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].couplingTargets && typeof entries[i].couplingTargets === 'object') {
      const raw = entries[i].couplingTargets;
      const result = {};
      const ctKeys = Object.keys(raw);
      for (let j = 0; j < ctKeys.length; j++) {
        const ct = raw[ctKeys[j]];
        if (ct && typeof ct === 'object' && typeof ct.baseline === 'number') {
          result[ctKeys[j]] = {
            baseline: ct.baseline,
            current: ct.current,
            drift: Number((ct.current - ct.baseline).toFixed(4)),
            driftRatio: ct.baseline > 0 ? Number((ct.current / ct.baseline).toFixed(2)) : null,
            rollingAbsCorr: ct.rollingAbsCorr,
            rawRollingAbsCorr: ct.rawRollingAbsCorr != null ? ct.rawRollingAbsCorr : null,
            gain: ct.gain,
            heatPenalty: ct.heatPenalty,
            effectivenessEma: ct.effectivenessEma != null ? ct.effectivenessEma : null,
            // R34 E3: Per-pair effectiveness temporal tracking
            effMin: ct.effMin != null ? ct.effMin : null,
            effMax: ct.effMax != null ? ct.effMax : null,
            effActiveBeats: ct.effActiveBeats != null ? ct.effActiveBeats : null
          };
        }
      }
      if (Object.keys(result).length > 0) adaptiveTargets = result;
    }
    // R28 E1: Prefer fully-populated axisCouplingTotals (all axes > 0).
    // On the last beat, phase pairs may have null correlations giving phase=0.
    // Take the first entry (from end) where all axes are non-zero; fall back
    // to first available if no fully-populated entry exists.
    if (entries[i].axisCouplingTotals && typeof entries[i].axisCouplingTotals === 'object') {
      if (!axisCouplingTotals) {
        axisCouplingTotals = entries[i].axisCouplingTotals;
      }
      if (!axisCouplingTotalsBest) {
        const vals = Object.values(entries[i].axisCouplingTotals);
        const allNonZero = vals.length >= 6 && vals.every(function(v) { return typeof v === 'number' && v > 0; });
        if (allNonZero) axisCouplingTotalsBest = entries[i].axisCouplingTotals;
      }
    }
    // R20 E6: Extract couplingHomeostasis state from final beat
    if (!couplingHomeostasisState && entries[i].couplingHomeostasis && typeof entries[i].couplingHomeostasis === 'object') {
      couplingHomeostasisState = entries[i].couplingHomeostasis;
    }
    // R28 E1: Prefer fully-populated axisEnergyShare (all shares > 0).
    if (entries[i].axisEnergyShare && typeof entries[i].axisEnergyShare === 'object') {
      if (!axisEnergyShare) {
        axisEnergyShare = entries[i].axisEnergyShare;
      }
      if (!axisEnergyShareBest) {
        const shares = entries[i].axisEnergyShare.shares || entries[i].axisEnergyShare;
        const sVals = typeof shares === 'object' ? Object.values(shares) : [];
        const allSharesNonZero = sVals.length >= 6 && sVals.every(function(v) { return typeof v === 'number' && v > 0; });
        if (allSharesNonZero) axisEnergyShareBest = entries[i].axisEnergyShare;
      }
    }
    // R27 E2: Extract coupling gates from final beat
    if (!couplingGates && entries[i].couplingGates && typeof entries[i].couplingGates === 'object') {
      couplingGates = entries[i].couplingGates;
    }
    // R33 E4: axisEnergyEquilibrator is now a top-level trace field
    // (conductorState.updateFromConductor silently drops state-provider fields,
    //  so the snap path never worked -- this is the direct bypass fix).
    if (!axisEnergyEquilibratorState && entries[i].axisEnergyEquilibrator &&
        typeof entries[i].axisEnergyEquilibrator === 'object') {
      axisEnergyEquilibratorState = entries[i].axisEnergyEquilibrator;
    }
    if (adaptiveTargets && axisCouplingTotals && couplingHomeostasisState && axisEnergyShare && couplingGates && axisEnergyEquilibratorState) break;
  }
  // R28 E1: Use fully-populated entries when available
  if (axisCouplingTotalsBest) axisCouplingTotals = axisCouplingTotalsBest;
  if (axisEnergyShareBest) axisEnergyShare = axisEnergyShareBest;

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
    regimeDepth: {
      maxConsecutiveCoherent,
      transitionCount: regimeTransitionCount
    },
    conductor: {
      playProb: finalizeMinMax(playProb),
      stutterProb: finalizeMinMax(stutterProb),
      density: finalizeMinMax(density),
      tension: finalizeMinMax(tension),
      flicker: finalizeMinMax(flicker)
    },
    couplingAbs: couplingSummary,
    couplingTail,
    couplingHotspots,
    couplingCorrelation,
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
      exceededRate: entries.length > 0 ? Number((beatSetupExceeded / entries.length).toFixed(4)) : 0,
      spikeIndices: beatSetupSpikeIndices
    },
    adaptiveTargets,
    axisCouplingTotals,
    axisEnergyShare,
    couplingGates,
    couplingHomeostasis: couplingHomeostasisState,
    // R32 E5: Axis energy equilibrator per-regime telemetry
    axisEnergyEquilibrator: axisEnergyEquilibratorState,
    // R34 E6: Regime transition readiness diagnostic
    transitionReadiness: readinessBeats > 0 ? {
      gapMin: Number(readinessGapMin.toFixed(4)),
      gapMax: Number(readinessGapMax.toFixed(4)),
      gapAvg: Number((readinessGapSum / readinessBeats).toFixed(4)),
      velocityBlockedBeats: readinessVelocityBlockedBeats,
      totalBeats: readinessBeats,
      velocityBlockedRate: Number((readinessVelocityBlockedBeats / readinessBeats).toFixed(4)),
      finalThresholdScale: readinessLastScale,
      // R35 E5: Exploring-block diagnostic breakdown
      exploringBlock: exploringBlockCounts,
      // R36 E4: Raw regime counts before hysteresis
      rawRegimeCounts
    } : null,
    // R35 E6: Per-pair exceedance beat counts (beats where |r| > 0.85)
    pairExceedanceBeats,
    // R32 E6: Intra-axis pair energy distribution diagnostic
    intraAxisDistribution: (() => {
      // Compute per-axis Gini coefficient and dominant pair from coupling data
      const ALL_AXES = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];
      const result = {};
      for (let a = 0; a < ALL_AXES.length; a++) {
        const axis = ALL_AXES[a];
        const pairAvgs = [];
        for (let k = 0; k < couplingKeys.length; k++) {
          const pair = couplingKeys[k];
          if (pair.indexOf(axis) !== -1 && couplingSummary[pair] && couplingSummary[pair].avg !== null) {
            pairAvgs.push({ pair, avg: couplingSummary[pair].avg });
          }
        }
        if (pairAvgs.length < 2) continue;
        // Sort by avg for Gini computation
        pairAvgs.sort((x, y) => x.avg - y.avg);
        const n = pairAvgs.length;
        let rankSum = 0;
        let total = 0;
        for (let j = 0; j < n; j++) {
          rankSum += (j + 1) * pairAvgs[j].avg;
          total += pairAvgs[j].avg;
        }
        const gini = total > 0 && n > 1
          ? Number(((2 * rankSum) / (n * total) - (n + 1) / n).toFixed(4))
          : 0;
        const dominant = pairAvgs[n - 1];
        result[axis] = {
          gini: Math.max(0, gini),
          pairCount: n,
          dominant: dominant.pair,
          dominantAvg: dominant.avg,
          pairs: pairAvgs.map(function(p) { return { pair: p.pair, avg: p.avg }; })
        };
      }
      return Object.keys(result).length > 0 ? result : null;
    })()
  };
}

function main() {
  const tracePath = path.join(process.cwd(), 'metrics', 'trace.jsonl');
  const summaryPath = path.join(process.cwd(), 'metrics', 'trace-summary.json');

  if (!fs.existsSync(tracePath)) {
    console.log('trace-summary: trace file not found, skipping (run with --trace to generate metrics/trace.jsonl).');
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
  console.log(`trace-summary: ${entries.length} entries -> metrics/trace-summary.json`);
}

main();
