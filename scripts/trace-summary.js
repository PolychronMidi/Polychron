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

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
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

function compareProgress(left, right) {
  if (left.section !== right.section) return left.section - right.section;
  if (left.phrase !== right.phrase) return left.phrase - right.phrase;
  if (left.measure !== right.measure) return left.measure - right.measure;
  return left.beat - right.beat;
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

function summarizeTrace(entries, manifest) {
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
  const trustHotspotPressureAbs = {};
  const trustDominantPairsBySystem = {};
  const stageTimingAgg = {}; // per-stage min/max/avg across all beats
  const BEAT_SETUP_BUDGET_MS = 200; // R9 Evo 5: flag beats where beat-setup exceeds this
  let beatSetupExceeded = 0;
  const beatSetupSpikeIndices = []; // R10 Evo 3: record which beats exceeded the budget
  const beatSetupSpikeStageAgg = {};
  let worstBeatSetupSpike = null;
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
  const uniqueBeatKeys = new Set();
  const sectionEntryCounts = {};
  const sectionBeatKeys = {};
  const uniqueProfilerAnalysisTicks = new Set();
  const uniqueProfilerRegimeTicks = new Set();
  let profilerCadence = '';
  let profilerSnapshotReuseEntries = 0;
  let profilerWarmupEntries = 0;
  let lastProfilerAnalysisTick = null;
  let profilerTelemetryBeatSpanSum = 0;
  let profilerTelemetryBeatSpanCount = 0;
  let profilerTelemetryBeatSpanMax = 0;
  let phaseTelemetryEntries = 0;
  let phaseTelemetryValidEntries = 0;
  let phaseTelemetryChangedEntries = 0;
  let phaseSignalInvalidEntries = 0;
  let phaseTelemetryMaxStaleBeats = 0;
  let phaseStaleEntries = 0;
  let phaseCouplingCoverageSum = 0;
  let phaseCouplingCoverageCount = 0;
  let phaseZeroCoverageEntries = 0;
  let phaseCouplingAvailablePairsMax = 0;
  let phaseCouplingMissingPairsMax = 0;
  const phasePairStateCounts = {};
  let phaseVarianceGatedEntries = 0;
  const phasePairStateDetailCounts = {};
  const layerBeatKeySets = { L1: new Set(), L2: new Set() };
  const beatKeyCounts = {};
  let duplicateLayerBeatKeys = 0;
  let l1ProgressRegressions = 0;
  let l1TimeRegressions = 0;
  let lastL1Progress = null;
  let lastL1TimeMs = null;
  let profilerEscalatedEntries = 0;
  const profilerAnalysisSources = {};
  const outputLoadGuardScale = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const outputLoadGuardRecentRate = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  const outputLoadGuardBeatScheduled = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  let outputLoadGuardedEntries = 0;
  let outputLoadHardEntries = 0;
  const forcedTransitionEventIds = new Set();
  const forcedTransitionEvents = [];
  // R34 E6: Transition readiness accumulators (per-beat gap + velocity tracking)
  let readinessGapSum = 0;
  let readinessGapMin = Infinity;
  let readinessGapMax = -Infinity;
  let readinessVelocityBlockedBeats = 0;
  let readinessBeats = 0;
  let readinessLastScale = null;
  let evolvingBeats = 0;
  let coherentBeats = 0;
  let runCoherentBeats = 0;
  let maxCoherentBeats = 0;
  let runBeatCount = 0;
  let runCoherentShare = 0;
  let runTransitionCount = 0;
  let forcedBreakCount = 0;
  let forcedRegime = '';
  let forcedRegimeBeatsRemaining = 0;
  let forcedOverrideBeats = 0;
  let lastForcedTriggerStreak = 0;
  let lastForcedTriggerBeat = 0;
  let lastForcedReason = '';
  let cadenceMonopolyPressure = 0;
  let cadenceMonopolyActive = false;
  let cadenceMonopolyReason = '';
  let rawExploringShare = 0;
  let rawEvolvingShare = 0;
  let rawNonCoherentOpportunityShare = 0;
  let resolvedNonCoherentShare = 0;
  let opportunityGap = 0;
  // R35 E5: Exploring-block diagnostic accumulators
  const exploringBlockCounts = { velocity: 0, dimension: 0, coupling: 0, none: 0 };
  const coherentBlockCounts = { velocity: 0, dimension: 0, coupling: 0, none: 0 };
  // R35 E6: Per-pair exceedance beat tracking (beats above 0.90)
  const pairExceedanceBeats = {};
  let uniqueExceedanceBeats = 0;
  // R58 E6: Guard/coupling interaction diagnostic. Partition coupling stats
  // by guarded (scale < 0.999) vs unguarded beats to reveal whether the
  // output-load guard inflates or dampens coupling through uniform suppression.
  const guardedCouplingAbs = {};
  const unguardedCouplingAbs = {};
  let guardedExceedanceBeats = 0;
  let unguardedExceedanceBeats = 0;
  let guardedBeatCount = 0;
  let unguardedBeatCount = 0;
  // R36 E4: Raw regime counts (cumulative from classifier, grab last beat)
  let rawRegimeCounts = null;
  let runRawRegimeCounts = null;
  let runResolvedRegimeCounts = null;
  // R37 E6: Raw regime max streak (cumulative, grab last beat)
  // R38 E6: Track max rawRollingAbsCorr across the run
  const rawEmaMaxSeries = {};
  let rawRegimeMaxStreak = null;
  // R37 E5: effectiveDim histogram -- collect all values for percentile computation
  const effectiveDimValues = [];

  // R66 E6: Mid-run diagnostic snapshots -- accumulated separately from beat entries
  const diagnosticArc = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    // R66 E6: Snapshot records are diagnostic, not beat entries. Accumulate
    // them into diagnosticArc and skip normal beat processing.
    if (e.recordType === 'snapshot') {
      diagnosticArc.push({
        snapshotIndex: e.snapshotIndex,
        beatKey: e.beatKey,
        timeMs: e.timeMs,
        effectiveDim: e.effectiveDim,
        globalGainMultiplier: e.globalGainMultiplier,
        regime: e.regime,
        couplingStrength: e.couplingStrength,
        phaseIntegrity: e.phaseIntegrity,
        trust: e.trust,
        couplingMeans: e.couplingMeans
      });
      continue;
    }

    const layer = typeof e.layer === 'string' ? e.layer : 'other';
    if (layer === 'L1' || layer === 'L2') byLayer[layer]++;
    else byLayer.other++;

    if (firstBeatKey === null && typeof e.beatKey === 'string') firstBeatKey = e.beatKey;
    if (typeof e.beatKey === 'string') lastBeatKey = e.beatKey;
    if (typeof e.beatKey === 'string') uniqueBeatKeys.add(e.beatKey);
    if (typeof e.beatKey === 'string' && e.beatKey) {
      beatKeyCounts[e.beatKey] = (beatKeyCounts[e.beatKey] || 0) + 1;
      if (layer === 'L1' || layer === 'L2') {
        if (layerBeatKeySets[layer].has(e.beatKey)) duplicateLayerBeatKeys++;
        else layerBeatKeySets[layer].add(e.beatKey);
      }
    }
    if (typeof e.beatKey === 'string' && e.beatKey.indexOf(':') !== -1) {
      const parsedSection = parseInt(e.beatKey.split(':')[0], 10);
      if (Number.isFinite(parsedSection)) {
        sectionEntryCounts[parsedSection] = (sectionEntryCounts[parsedSection] || 0) + 1;
        if (!sectionBeatKeys[parsedSection]) sectionBeatKeys[parsedSection] = new Set();
        sectionBeatKeys[parsedSection].add(e.beatKey);
      }
    }

    const timeMs = toNum(e.timeMs, NaN);
    if (Number.isFinite(timeMs)) {
      if (firstTimeMs === null || timeMs < firstTimeMs) firstTimeMs = timeMs;
      if (lastTimeMs === null || timeMs > lastTimeMs) lastTimeMs = timeMs;
      if (layer === 'L1') {
        if (lastL1TimeMs !== null && timeMs + 0.001 < lastL1TimeMs) l1TimeRegressions++;
        lastL1TimeMs = timeMs;
      }
    }
    if (layer === 'L1' && typeof e.beatKey === 'string' && e.beatKey.indexOf(':') !== -1) {
      const parts = e.beatKey.split(':').map(function(part) { return parseInt(part, 10); });
      if (parts.length >= 4 && parts.every(function(value) { return Number.isFinite(value); })) {
        const progress = { section: parts[0], phrase: parts[1], measure: parts[2], beat: parts[3] };
        if (lastL1Progress && compareProgress(progress, lastL1Progress) <= 0) l1ProgressRegressions++;
        lastL1Progress = progress;
      }
    }

    const snap = e.snap && typeof e.snap === 'object' ? e.snap : {};
    const regime = typeof e.regime === 'string' ? e.regime : 'unknown';
    regimeCounts[regime] = (regimeCounts[regime] || 0) + 1;

    if (e.profilerTelemetry && typeof e.profilerTelemetry === 'object') {
      const pt = e.profilerTelemetry;
      if (typeof pt.cadence === 'string' && pt.cadence) profilerCadence = pt.cadence;
      if (pt.cadenceEscalated) profilerEscalatedEntries++;
      if (typeof pt.analysisSource === 'string' && pt.analysisSource) {
        profilerAnalysisSources[pt.analysisSource] = (profilerAnalysisSources[pt.analysisSource] || 0) + 1;
      }
      if (typeof pt.analysisTick === 'number' && Number.isFinite(pt.analysisTick) && pt.analysisTick > 0) {
        uniqueProfilerAnalysisTicks.add(pt.analysisTick);
        if (lastProfilerAnalysisTick !== null && pt.analysisTick === lastProfilerAnalysisTick) {
          profilerSnapshotReuseEntries++;
        }
        lastProfilerAnalysisTick = pt.analysisTick;
      }
      if (typeof pt.regimeTick === 'number' && Number.isFinite(pt.regimeTick) && pt.regimeTick > 0) {
        uniqueProfilerRegimeTicks.add(pt.regimeTick);
      }
      if (typeof pt.warmupTicksRemaining === 'number' && pt.warmupTicksRemaining > 0) {
        profilerWarmupEntries++;
      }
      if (typeof pt.telemetryBeatSpan === 'number' && Number.isFinite(pt.telemetryBeatSpan) && pt.telemetryBeatSpan > 0) {
        profilerTelemetryBeatSpanSum += pt.telemetryBeatSpan;
        profilerTelemetryBeatSpanCount++;
        if (pt.telemetryBeatSpan > profilerTelemetryBeatSpanMax) profilerTelemetryBeatSpanMax = pt.telemetryBeatSpan;
      }
    }
    if (e.phaseTelemetry && typeof e.phaseTelemetry === 'object') {
      const phaseTelemetry = e.phaseTelemetry;
      let varianceGated = false;
      let stalePairObserved = false;
      phaseTelemetryEntries++;
      if (phaseTelemetry.phaseSignalValid) phaseTelemetryValidEntries++;
      else phaseSignalInvalidEntries++;
      if (phaseTelemetry.phaseChanged) phaseTelemetryChangedEntries++;
      if (typeof phaseTelemetry.phaseStaleBeats === 'number') {
        phaseTelemetryMaxStaleBeats = Math.max(phaseTelemetryMaxStaleBeats, phaseTelemetry.phaseStaleBeats);
        if (phaseTelemetry.phaseStaleBeats > 0) phaseStaleEntries++;
      }
      if (typeof phaseTelemetry.phaseCouplingCoverage === 'number') {
        phaseCouplingCoverageSum += phaseTelemetry.phaseCouplingCoverage;
        phaseCouplingCoverageCount++;
        if (phaseTelemetry.phaseCouplingCoverage <= 0.01) phaseZeroCoverageEntries++;
      }
      if (typeof phaseTelemetry.phaseCouplingAvailablePairs === 'number') {
        phaseCouplingAvailablePairsMax = Math.max(phaseCouplingAvailablePairsMax, phaseTelemetry.phaseCouplingAvailablePairs);
      }
      if (typeof phaseTelemetry.phaseCouplingMissingPairs === 'number') {
        phaseCouplingMissingPairsMax = Math.max(phaseCouplingMissingPairsMax, phaseTelemetry.phaseCouplingMissingPairs);
      }
      if (phaseTelemetry.pairStates && typeof phaseTelemetry.pairStates === 'object') {
        const pairStateKeys = Object.keys(phaseTelemetry.pairStates);
        for (let pairIndex = 0; pairIndex < pairStateKeys.length; pairIndex++) {
          const pairKey = pairStateKeys[pairIndex];
          const state = phaseTelemetry.pairStates[pairKey];
          if (typeof state !== 'string' || !state) continue;
          phasePairStateCounts[state] = (phasePairStateCounts[state] || 0) + 1;
          if (!phasePairStateDetailCounts[pairKey]) phasePairStateDetailCounts[pairKey] = {};
          phasePairStateDetailCounts[pairKey][state] = (phasePairStateDetailCounts[pairKey][state] || 0) + 1;
          if (state === 'variance-gated') varianceGated = true;
          if (state === 'stale' || state === 'stale-gated') stalePairObserved = true;
        }
      }
      if (varianceGated) phaseVarianceGatedEntries++;
      else if (stalePairObserved) phaseStaleEntries++;
    }

    if (e.outputLoadGuard && typeof e.outputLoadGuard === 'object') {
      const guard = e.outputLoadGuard;
      const scale = toNum(guard.scale, NaN);
      const recentRate = toNum(guard.recentPrimaryNotesPerSecond, NaN);
      const beatScheduledNotes = toNum(guard.beatScheduledNotes, NaN);
      if (Number.isFinite(scale)) {
        updateMinMax(outputLoadGuardScale, scale);
        if (scale < 0.999) outputLoadGuardedEntries++;
      }
      if (Number.isFinite(recentRate)) updateMinMax(outputLoadGuardRecentRate, recentRate);
      if (Number.isFinite(beatScheduledNotes)) updateMinMax(outputLoadGuardBeatScheduled, beatScheduledNotes);
      if (guard.severity === 'hard') outputLoadHardEntries++;
    }

    if (e.forcedTransitionEvent && typeof e.forcedTransitionEvent === 'object') {
      const fte = e.forcedTransitionEvent;
      const eventId = typeof fte.eventId === 'number' && Number.isFinite(fte.eventId)
        ? fte.eventId
        : forcedTransitionEvents.length + 1;
      if (!forcedTransitionEventIds.has(eventId)) {
        forcedTransitionEventIds.add(eventId);
        forcedTransitionEvents.push({
          eventId,
          from: typeof fte.from === 'string' ? fte.from : '',
          to: typeof fte.to === 'string' ? fte.to : '',
          reason: typeof fte.reason === 'string' ? fte.reason : '',
          triggerTick: typeof fte.triggerTick === 'number' ? fte.triggerTick : null,
          triggerStreak: typeof fte.triggerStreak === 'number' ? fte.triggerStreak : null,
          runTickCount: typeof fte.runTickCount === 'number' ? fte.runTickCount : null,
          runTransitionCount: typeof fte.runTransitionCount === 'number' ? fte.runTransitionCount : null,
          runCoherentBeats: typeof fte.runCoherentBeats === 'number' ? fte.runCoherentBeats : null,
          runCoherentShare: typeof fte.runCoherentShare === 'number' ? fte.runCoherentShare : null,
          forcedBeatsRemaining: typeof fte.forcedBeatsRemaining === 'number' ? fte.forcedBeatsRemaining : null
        });
      }
    }

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
        if (typeof tr.evolvingBeats === 'number') evolvingBeats = tr.evolvingBeats;
        if (typeof tr.coherentBeats === 'number') coherentBeats = Math.max(coherentBeats, tr.coherentBeats);
        if (typeof tr.runCoherentBeats === 'number') runCoherentBeats = Math.max(runCoherentBeats, tr.runCoherentBeats);
        if (typeof tr.maxCoherentBeats === 'number' && tr.maxCoherentBeats > maxCoherentBeats) maxCoherentBeats = tr.maxCoherentBeats;
        if (typeof tr.runBeatCount === 'number') runBeatCount = Math.max(runBeatCount, tr.runBeatCount);
        if (typeof tr.runCoherentShare === 'number') runCoherentShare = tr.runCoherentShare;
        if (typeof tr.runTransitionCount === 'number') runTransitionCount = Math.max(runTransitionCount, tr.runTransitionCount);
        if (typeof tr.forcedBreakCount === 'number') forcedBreakCount = Math.max(forcedBreakCount, tr.forcedBreakCount);
        if (typeof tr.forcedRegime === 'string') forcedRegime = tr.forcedRegime;
        if (typeof tr.forcedRegimeBeatsRemaining === 'number') forcedRegimeBeatsRemaining = tr.forcedRegimeBeatsRemaining;
        if (typeof tr.forcedOverrideBeats === 'number') {
          if (tr.forcedOverrideBeats > forcedOverrideBeats) forcedOverrideBeats = tr.forcedOverrideBeats;
        } else if (tr.forcedOverrideActive) {
          forcedOverrideBeats++;
        }
        if (typeof tr.lastForcedTriggerStreak === 'number') lastForcedTriggerStreak = tr.lastForcedTriggerStreak;
        if (typeof tr.lastForcedTriggerBeat === 'number') lastForcedTriggerBeat = tr.lastForcedTriggerBeat;
        if (typeof tr.lastForcedReason === 'string') lastForcedReason = tr.lastForcedReason;
        if (typeof tr.cadenceMonopolyPressure === 'number') cadenceMonopolyPressure = tr.cadenceMonopolyPressure;
        if (typeof tr.cadenceMonopolyActive === 'boolean') cadenceMonopolyActive = tr.cadenceMonopolyActive;
        if (typeof tr.cadenceMonopolyReason === 'string') cadenceMonopolyReason = tr.cadenceMonopolyReason;
        if (typeof tr.rawExploringShare === 'number') rawExploringShare = tr.rawExploringShare;
        if (typeof tr.rawEvolvingShare === 'number') rawEvolvingShare = tr.rawEvolvingShare;
        if (typeof tr.rawNonCoherentOpportunityShare === 'number') rawNonCoherentOpportunityShare = tr.rawNonCoherentOpportunityShare;
        if (typeof tr.resolvedNonCoherentShare === 'number') resolvedNonCoherentShare = tr.resolvedNonCoherentShare;
        if (typeof tr.opportunityGap === 'number') opportunityGap = tr.opportunityGap;
      }
      // R35 E5: Accumulate exploring-block diagnostic
      if (typeof tr.exploringBlock === 'string' && exploringBlockCounts[tr.exploringBlock] !== undefined) {
        exploringBlockCounts[tr.exploringBlock]++;
      }
      if (typeof tr.coherentBlock === 'string' && coherentBlockCounts[tr.coherentBlock] !== undefined) {
        coherentBlockCounts[tr.coherentBlock]++;
      }
      // R36 E4: Grab cumulative raw regime counts (last beat wins)
      if (tr.rawRegimeCounts && typeof tr.rawRegimeCounts === 'object') {
        rawRegimeCounts = tr.rawRegimeCounts;
      }
      if (tr.runRawRegimeCounts && typeof tr.runRawRegimeCounts === 'object') {
        runRawRegimeCounts = tr.runRawRegimeCounts;
      }
      if (tr.runResolvedRegimeCounts && typeof tr.runResolvedRegimeCounts === 'object') {
        runResolvedRegimeCounts = tr.runResolvedRegimeCounts;
      }
      // R37 E6: Grab cumulative raw regime max streaks (last beat wins)
      if (tr.rawRegimeMaxStreak && typeof tr.rawRegimeMaxStreak === 'object') {
        rawRegimeMaxStreak = tr.rawRegimeMaxStreak;
      }
      // R37 E5: Collect effectiveDim for histogram
      if (typeof tr.effectiveDim === 'number' && Number.isFinite(tr.effectiveDim)) {
        effectiveDimValues.push(tr.effectiveDim);
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
    let beatHadExceedance = false;
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
      // R44 E6: Track beats where |r| > 0.90 per pair (broadened from 0.85 for 400+ beat runtimes)
      if (value > 0.90) {
        pairExceedanceBeats[key] = (pairExceedanceBeats[key] || 0) + 1;
        beatHadExceedance = true;
      }
    }
    if (beatHadExceedance) uniqueExceedanceBeats++;

    // R58 E6: Partition coupling stats by guarded vs unguarded beat
    const guardObj = e.outputLoadGuard && typeof e.outputLoadGuard === 'object' ? e.outputLoadGuard : null;
    const guardScale = guardObj ? toNum(guardObj.scale, 1) : 1;
    const beatIsGuarded = guardScale < 0.999;
    if (beatIsGuarded) guardedBeatCount++;
    else unguardedBeatCount++;
    if (beatHadExceedance) {
      if (beatIsGuarded) guardedExceedanceBeats++;
      else unguardedExceedanceBeats++;
    }
    for (let j = 0; j < couplingKeys.length; j++) {
      const key = couplingKeys[j];
      const value = Math.abs(toNum(cm[key], 0));
      const bucket = beatIsGuarded ? guardedCouplingAbs : unguardedCouplingAbs;
      if (!bucket[key]) bucket[key] = { sum: 0, count: 0 };
      bucket[key].sum += value;
      bucket[key].count++;
    }

    // R38 E6: Populate rawEmaMaxSeries from couplingTargets
    if (e.couplingTargets && typeof e.couplingTargets === 'object') {
      const ctKeys = Object.keys(e.couplingTargets);
      for (let j = 0; j < ctKeys.length; j++) {
        const pair = ctKeys[j];
        const ct = e.couplingTargets[pair];
        if (ct && typeof ct === 'object' && typeof ct.rawRollingAbsCorr === 'number') {
          if (!rawEmaMaxSeries[pair]) rawEmaMaxSeries[pair] = { max: -Infinity, count: 0 };
          if (ct.rawRollingAbsCorr > rawEmaMaxSeries[pair].max) rawEmaMaxSeries[pair].max = ct.rawRollingAbsCorr;
          rawEmaMaxSeries[pair].count++;
        }
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

        const hotspotPressure = Math.abs(toNum(entry.hotspotPressure, NaN));
        if (Number.isFinite(hotspotPressure)) {
          if (!trustHotspotPressureAbs[key]) trustHotspotPressureAbs[key] = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
          updateMinMax(trustHotspotPressureAbs[key], hotspotPressure);
        }

        if (typeof entry.dominantPair === 'string' && entry.dominantPair) {
          if (!trustDominantPairsBySystem[key]) trustDominantPairsBySystem[key] = {};
          trustDominantPairsBySystem[key][entry.dominantPair] = (trustDominantPairsBySystem[key][entry.dominantPair] || 0) + 1;
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
        let dominantSubstage = 'beat-setup';
        let dominantSubstageMs = setupMs;
        for (let k = 0; k < stKeys.length; k++) {
          const stageMs = toNum(st[stKeys[k]], NaN);
          if (!Number.isFinite(stageMs)) continue;
          stages[stKeys[k]] = Number(stageMs.toFixed(4));
          if (stKeys[k] !== 'beat-setup' && stageMs > dominantSubstageMs) {
            dominantSubstage = stKeys[k];
            dominantSubstageMs = stageMs;
          }
        }
        if (dominantSubstage === 'beat-setup') dominantSubstageMs = setupMs;
        if (!beatSetupSpikeStageAgg[dominantSubstage]) {
          beatSetupSpikeStageAgg[dominantSubstage] = { count: 0, totalMs: 0, maxMs: 0 };
        }
        beatSetupSpikeStageAgg[dominantSubstage].count++;
        beatSetupSpikeStageAgg[dominantSubstage].totalMs += dominantSubstageMs;
        beatSetupSpikeStageAgg[dominantSubstage].maxMs = Math.max(beatSetupSpikeStageAgg[dominantSubstage].maxMs, dominantSubstageMs);
        const spike = {
          index: i,
          ms: Number(setupMs.toFixed(4)),
          dominantSubstage,
          dominantSubstageMs: Number(dominantSubstageMs.toFixed(4)),
          stages
        };
        beatSetupSpikeIndices.push(spike);
        if (!worstBeatSetupSpike || spike.ms > worstBeatSetupSpike.ms) worstBeatSetupSpike = spike;
      }
    }
  }

  if (uniqueProfilerRegimeTicks.size > 0 && runBeatCount < uniqueProfilerRegimeTicks.size) {
    runBeatCount = uniqueProfilerRegimeTicks.size;
  }
  if (forcedTransitionEvents.length > forcedBreakCount) {
    forcedBreakCount = forcedTransitionEvents.length;
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

  const exceedancePairsSorted = Object.entries(pairExceedanceBeats)
    .map(function(entry) { return { pair: entry[0], beats: entry[1] }; })
    .sort(function(a, b) { return b.beats - a.beats; });

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

  const trustHotspotPressureSummary = {};
  const trustHotspotKeys = Object.keys(trustHotspotPressureAbs).sort();
  for (let i = 0; i < trustHotspotKeys.length; i++) {
    const key = trustHotspotKeys[i];
    trustHotspotPressureSummary[key] = finalizeMinMax(trustHotspotPressureAbs[key]);
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
            effectiveGain: ct.effectiveGain != null ? ct.effectiveGain : null,
            nudgeable: ct.nudgeable !== false,
            p95AbsCorr: ct.p95AbsCorr != null ? ct.p95AbsCorr : null,
            hotspotRate: ct.hotspotRate != null ? ct.hotspotRate : null,
            severeRate: ct.severeRate != null ? ct.severeRate : null,
            recentP95AbsCorr: ct.recentP95AbsCorr != null ? ct.recentP95AbsCorr : null,
            recentHotspotRate: ct.recentHotspotRate != null ? ct.recentHotspotRate : null,
            recentSevereRate: ct.recentSevereRate != null ? ct.recentSevereRate : null,
            telemetryWindowBeats: ct.telemetryWindowBeats != null ? ct.telemetryWindowBeats : null,
            residualPressure: ct.residualPressure != null ? ct.residualPressure : null,
            budgetScore: ct.budgetScore != null ? ct.budgetScore : 0,
            budgetBoost: ct.budgetBoost != null ? ct.budgetBoost : 1,
            budgetRank: ct.budgetRank != null ? ct.budgetRank : null,
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

  // R38 E6: Inject rawEmaMax into adaptiveTargets
  if (adaptiveTargets) {
    const rawKeys = Object.keys(rawEmaMaxSeries);
    for (let c = 0; c < rawKeys.length; c++) {
      const pair = rawKeys[c];
      if (adaptiveTargets[pair] && rawEmaMaxSeries[pair].count > 0) {
        adaptiveTargets[pair].rawEmaMax = Number(rawEmaMaxSeries[pair].max.toFixed(4));
      }
    }
  }

  let nonNudgeableGains = null;
  if (adaptiveTargets) {
    const nonNudgeablePairs = Object.entries(adaptiveTargets)
      .filter(function(entry) { return entry[1] && entry[1].nudgeable === false; })
      .map(function(entry) {
        return {
          pair: entry[0],
          gain: entry[1].gain,
          effectiveGain: entry[1].effectiveGain,
          rawRollingAbsCorr: entry[1].rawRollingAbsCorr,
          rawEmaMax: entry[1].rawEmaMax != null ? entry[1].rawEmaMax : null
        };
      });
    if (nonNudgeablePairs.length > 0) {
      nonNudgeableGains = {
        pairCount: nonNudgeablePairs.length,
        nonZeroGainPairs: nonNudgeablePairs.filter(function(pair) { return toNum(pair.gain, 0) > 0.0001; }).length,
        nonZeroEffectiveGainPairs: nonNudgeablePairs.filter(function(pair) { return toNum(pair.effectiveGain, 0) > 0.0001; }).length,
        pairs: nonNudgeablePairs
      };
    }
  }

  const tailRecovery = couplingHomeostasisState && couplingHomeostasisState.tailPressureByPair && typeof couplingHomeostasisState.tailPressureByPair === 'object'
    ? {
      stickyTailPressure: toNum(couplingHomeostasisState.stickyTailPressure, 0),
      densityFlickerTailPressure: toNum(couplingHomeostasisState.densityFlickerTailPressure, 0),
      tailRecoveryDrive: toNum(couplingHomeostasisState.tailRecoveryDrive, 0),
      tailRecoveryTrigger: toNum(couplingHomeostasisState.tailRecoveryTrigger, 0),
      tailRecoveryHandshake: toNum(couplingHomeostasisState.tailRecoveryHandshake, 0),
      tailRecoveryCap: toNum(couplingHomeostasisState.tailRecoveryCap, 1),
      tailRecoveryCeilingPressure: toNum(couplingHomeostasisState.tailRecoveryCeilingPressure, 0),
      dominantTailPair: typeof couplingHomeostasisState.dominantTailPair === 'string' ? couplingHomeostasisState.dominantTailPair : '',
      tailHotspotCount: toNum(couplingHomeostasisState.tailHotspotCount, 0),
      floorRecoveryActive: Boolean(couplingHomeostasisState.floorRecoveryActive),
      floorRecoveryTicksRemaining: toNum(couplingHomeostasisState.floorRecoveryTicksRemaining, 0),
      floorContactBeats: toNum(couplingHomeostasisState.floorContactBeats, 0),
      persistentPairCount: Object.values(couplingHomeostasisState.tailPressureByPair).filter(function(value) { return toNum(value, 0) > 0.03; }).length,
      activePairCount: Object.values(couplingHomeostasisState.tailPressureByPair).filter(function(value) { return toNum(value, 0) > 0.08; }).length,
      topPairs: Object.entries(couplingHomeostasisState.tailPressureByPair)
        .map(function(entry) { return { pair: entry[0], pressure: Number(toNum(entry[1], 0).toFixed(4)) }; })
        .sort(function(a, b) { return b.pressure - a.pressure; })
        .slice(0, 5)
    }
    : null;

  const trustDominance = (() => {
    const dominantSystems = trustKeys
      .map(function(key) {
        return {
          system: key,
          score: Number(toNum(trustScoreSummary[key] && trustScoreSummary[key].avg, 0).toFixed(4)),
          weight: Number(toNum(trustWeightSummary[key] && trustWeightSummary[key].avg, 0).toFixed(4))
        };
      })
      .sort(function(a, b) { return b.score - a.score; })
      .slice(0, 5);
    const trustHotspotPairs = Object.entries(pairExceedanceBeats)
      .filter(function(entry) { return entry[0].indexOf('trust') !== -1; })
      .map(function(entry) { return { pair: entry[0], beats: entry[1] }; })
      .sort(function(a, b) { return b.beats - a.beats; });
    const trustAxisShare = axisEnergyShare && axisEnergyShare.shares && typeof axisEnergyShare.shares.trust === 'number'
      ? Number(axisEnergyShare.shares.trust.toFixed(4))
      : null;
    const coherenceMonitor = dominantSystems.find(function(entry) { return entry.system === 'coherenceMonitor'; }) || null;
    const pairAwareSystems = Object.keys(trustHotspotPressureSummary)
      .map(function(system) {
        const dominantPairs = trustDominantPairsBySystem[system] || {};
        const sortedPairs = Object.entries(dominantPairs).sort(function(a, b) { return b[1] - a[1]; });
        return {
          system,
          hotspotPressure: Number(toNum(trustHotspotPressureSummary[system] && trustHotspotPressureSummary[system].avg, 0).toFixed(4)),
          dominantPair: sortedPairs.length > 0 ? sortedPairs[0][0] : '',
          dominantPairCount: sortedPairs.length > 0 ? sortedPairs[0][1] : 0
        };
      })
      .sort(function(a, b) { return b.hotspotPressure - a.hotspotPressure; })
      .slice(0, 5);
    return {
      dominantSystems: dominantSystems.slice(0, 3),
      dominantCountAbove06: dominantSystems.filter(function(entry) { return entry.score > 0.60; }).length,
      dominanceSpread: dominantSystems.length > 1 ? Number((dominantSystems[0].score - dominantSystems[1].score).toFixed(4)) : 0,
      dominantWeightSpread: dominantSystems.length > 1 ? Number((dominantSystems[0].weight - dominantSystems[1].weight).toFixed(4)) : 0,
      dominantSystem: dominantSystems.length > 0 ? dominantSystems[0].system : '',
      dominantScore: dominantSystems.length > 0 ? dominantSystems[0].score : 0,
      dominantWeight: dominantSystems.length > 0 ? dominantSystems[0].weight : 0,
      coherenceMonitor,
      pairAwareSystems,
      trustAxisShare,
      trustPairExceedanceBeats: trustHotspotPairs.reduce(function(sum, entry) { return sum + entry.beats; }, 0),
      trustHotspotPairs: trustHotspotPairs.slice(0, 5)
    };
  })();

  const adaptiveTelemetryReconciliation = adaptiveTargets
    ? (() => {
      const mismatchedPairs = Object.keys(adaptiveTargets)
        .map(function(pair) {
          const controller = adaptiveTargets[pair];
          const traceTail = couplingTail[pair];
          const traceP95 = traceTail && typeof traceTail.p95 === 'number' ? traceTail.p95 : null;
          if (traceP95 === null) return null;
          const controllerP95 = toNum(controller.p95AbsCorr, 0);
          const recentP95 = toNum(controller.recentP95AbsCorr, controllerP95);
          const gap = Number((traceP95 - controllerP95).toFixed(4));
          const recentGap = Number((traceP95 - recentP95).toFixed(4));
          return {
            pair,
            traceP95: Number(traceP95.toFixed(4)),
            controllerP95: Number(controllerP95.toFixed(4)),
            recentP95: Number(recentP95.toFixed(4)),
            gap,
            recentGap,
            telemetryWindowBeats: controller.telemetryWindowBeats != null ? controller.telemetryWindowBeats : null
          };
        })
        .filter(function(entry) { return entry && entry.gap > 0.08; })
        .sort(function(a, b) { return b.gap - a.gap; });
      return {
        underSeenPairCount: mismatchedPairs.length,
        maxGap: mismatchedPairs.length > 0 ? mismatchedPairs[0].gap : 0,
        pairs: mismatchedPairs.slice(0, 5)
      };
    })()
    : null;

  const cadenceMonopoly = readinessBeats > 0 ? {
    pressure: Number(cadenceMonopolyPressure.toFixed(4)),
    active: cadenceMonopolyActive,
    reason: cadenceMonopolyReason,
    rawExploringShare: Number(rawExploringShare.toFixed(4)),
    rawEvolvingShare: Number(rawEvolvingShare.toFixed(4)),
    rawNonCoherentOpportunityShare: Number(rawNonCoherentOpportunityShare.toFixed(4)),
    resolvedNonCoherentShare: Number(resolvedNonCoherentShare.toFixed(4)),
    opportunityGap: Number(opportunityGap.toFixed(4))
  } : null;

  const overfullBeatKeys = Object.keys(beatKeyCounts).filter(function(key) { return beatKeyCounts[key] > 2; }).length;
  const pairedBeatKeys = Object.keys(beatKeyCounts).filter(function(key) { return beatKeyCounts[key] === 2; }).length;
  const progressIntegrity = {
    duplicateLayerBeatKeys,
    overfullBeatKeys,
    l1ProgressRegressions,
    l1TimeRegressions,
    pairedBeatKeys,
    pairedBeatKeyRatio: uniqueBeatKeys.size > 0 ? Number((pairedBeatKeys / uniqueBeatKeys.size).toFixed(4)) : null,
    integrity: duplicateLayerBeatKeys > 0 || overfullBeatKeys > 0 || l1ProgressRegressions > 0 || l1TimeRegressions > 0
      ? 'critical'
      : (uniqueBeatKeys.size > 0 && pairedBeatKeys < uniqueBeatKeys.size * 0.75 ? 'warning' : 'healthy')
  };
  const outputLoadGuard = outputLoadGuardScale.count > 0
    ? {
      guardedEntries: outputLoadGuardedEntries,
      guardedRate: entries.length > 0 ? Number((outputLoadGuardedEntries / entries.length).toFixed(4)) : 0,
      hardGuardEntries: outputLoadHardEntries,
      hardGuardRate: entries.length > 0 ? Number((outputLoadHardEntries / entries.length).toFixed(4)) : 0,
      scale: finalizeMinMax(outputLoadGuardScale),
      recentPrimaryNotesPerSecond: finalizeMinMax(outputLoadGuardRecentRate),
      beatScheduledNotes: finalizeMinMax(outputLoadGuardBeatScheduled)
    }
    : null;
  const phaseTelemetry = phaseTelemetryEntries > 0
    ? {
      entries: phaseTelemetryEntries,
      validEntries: phaseTelemetryValidEntries,
      invalidEntries: phaseSignalInvalidEntries,
      validRate: Number((phaseTelemetryValidEntries / phaseTelemetryEntries).toFixed(4)),
      changedEntries: phaseTelemetryChangedEntries,
      changedRate: Number((phaseTelemetryChangedEntries / phaseTelemetryEntries).toFixed(4)),
      maxStaleBeats: phaseTelemetryMaxStaleBeats,
      staleEntries: phaseStaleEntries,
      staleRate: Number((phaseStaleEntries / phaseTelemetryEntries).toFixed(4)),
      avgCouplingCoverage: phaseCouplingCoverageCount > 0 ? Number((phaseCouplingCoverageSum / phaseCouplingCoverageCount).toFixed(4)) : 0,
      zeroCouplingCoverageEntries: phaseZeroCoverageEntries,
      maxAvailablePairs: phaseCouplingAvailablePairsMax,
      maxMissingPairs: phaseCouplingMissingPairsMax,
      varianceGatedEntries: phaseVarianceGatedEntries,
      varianceGatedRate: Number((phaseVarianceGatedEntries / phaseTelemetryEntries).toFixed(4)),
      pairStateCounts: Object.keys(phasePairStateCounts).length > 0 ? phasePairStateCounts : null,
      pairStateDetailCounts: Object.keys(phasePairStateDetailCounts).length > 0 ? phasePairStateDetailCounts : null,
      integrity: phaseSignalInvalidEntries > 0 || phaseZeroCoverageEntries === phaseTelemetryEntries
        ? 'critical'
        : (phaseTelemetryMaxStaleBeats > 32 || phaseStaleEntries > 0 || phaseZeroCoverageEntries > 0 || phaseVarianceGatedEntries > 0 ? 'warning' : 'healthy')
    }
    : null;
  const telemetryHealth = (() => {
    const phaseTelemetryPresent = phaseTelemetry !== null;
    const phaseIntegrity = phaseTelemetryPresent ? phaseTelemetry.integrity : 'critical';
    const underSeenPairCount = adaptiveTelemetryReconciliation ? adaptiveTelemetryReconciliation.underSeenPairCount : 0;
    const maxGap = adaptiveTelemetryReconciliation ? adaptiveTelemetryReconciliation.maxGap : 0;
    const progressPenalty = progressIntegrity.integrity === 'critical' ? 0.12 : progressIntegrity.integrity === 'warning' ? 0.05 : 0;
    const phaseAvailabilityPenalty = phaseTelemetry && typeof phaseTelemetry.varianceGatedRate === 'number'
      ? clamp(phaseTelemetry.varianceGatedRate / 0.85, 0, 1) * 0.04
      : 0;
    const phaseStalePenalty = phaseTelemetry && typeof phaseTelemetry.staleRate === 'number'
      ? clamp(phaseTelemetry.staleRate / 0.35, 0, 1) * 0.05
      : 0;
    const score = clamp(
      (phaseTelemetryPresent ? 0 : 0.45) +
      (phaseIntegrity === 'critical' ? 0.25 : phaseIntegrity === 'warning' ? 0.12 : 0) +
      clamp(underSeenPairCount / 4, 0, 1) * 0.20 +
      clamp(maxGap / 0.5, 0, 1) * 0.08 +
      progressPenalty +
      phaseAvailabilityPenalty +
      phaseStalePenalty,
      0,
      1
    );
    return {
      score: Number(score.toFixed(4)),
      phaseTelemetryPresent,
      phaseIntegrity,
      underSeenPairCount,
      maxGap: Number(toNum(maxGap, 0).toFixed(4)),
      progressIntegrity: progressIntegrity.integrity,
      phaseStaleRate: phaseTelemetry && typeof phaseTelemetry.staleRate === 'number' ? phaseTelemetry.staleRate : null,
      profilerBeatSpanAvg: profilerTelemetryBeatSpanCount > 0 ? Number((profilerTelemetryBeatSpanSum / profilerTelemetryBeatSpanCount).toFixed(4)) : null,
      profilerBeatSpanMax: profilerTelemetryBeatSpanCount > 0 ? profilerTelemetryBeatSpanMax : null
    };
  })();

  return {
    generatedAt: new Date().toISOString(),
    beats: {
      totalEntries: entries.length - diagnosticArc.length,
      uniqueBeatKeys: uniqueBeatKeys.size,
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
      spikeIndices: beatSetupSpikeIndices,
      worstSpike: worstBeatSetupSpike,
      topSubstages: Object.entries(beatSetupSpikeStageAgg)
        .map(function(entry) {
          return {
            stage: entry[0],
            count: entry[1].count,
            avgMs: Number((entry[1].totalMs / entry[1].count).toFixed(4)),
            maxMs: Number(entry[1].maxMs.toFixed(4)),
            share: beatSetupExceeded > 0 ? Number((entry[1].count / beatSetupExceeded).toFixed(4)) : 0
          };
        })
        .sort(function(a, b) {
          if (b.count !== a.count) return b.count - a.count;
          return b.maxMs - a.maxMs;
        })
        .slice(0, 5)
    },
    adaptiveTargets,
    axisCouplingTotals,
    axisEnergyShare,
    couplingGates,
    couplingHomeostasis: couplingHomeostasisState,
    // R32 E5: Axis energy equilibrator per-regime telemetry
    axisEnergyEquilibrator: axisEnergyEquilibratorState,
    outputLoadGuard,
    profilerCadence: {
      cadence: profilerCadence || 'unknown',
      analysisTicks: uniqueProfilerAnalysisTicks.size,
      regimeTicks: uniqueProfilerRegimeTicks.size,
      snapshotReuseEntries: profilerSnapshotReuseEntries,
      warmupEntries: profilerWarmupEntries,
      escalatedEntries: profilerEscalatedEntries,
      analysisSources: Object.keys(profilerAnalysisSources).length > 0 ? profilerAnalysisSources : null,
      telemetryBeatSpanAvg: profilerTelemetryBeatSpanCount > 0 ? Number((profilerTelemetryBeatSpanSum / profilerTelemetryBeatSpanCount).toFixed(4)) : null,
      telemetryBeatSpanMax: profilerTelemetryBeatSpanCount > 0 ? profilerTelemetryBeatSpanMax : null
    },
    regimeCadence: {
      traceEntries: entries.length,
      profilerTicks: uniqueProfilerAnalysisTicks.size,
      traceEntriesPerProfilerTick: uniqueProfilerAnalysisTicks.size > 0
        ? Number((entries.length / uniqueProfilerAnalysisTicks.size).toFixed(2))
        : null,
      traceEntryCounts: regimeCounts,
      profilerTickResolvedCounts: runResolvedRegimeCounts,
      profilerTickRawCounts: runRawRegimeCounts,
      snapshotReuseEntries: profilerSnapshotReuseEntries,
      warmupEntries: profilerWarmupEntries
    },
    forcedTransitionEvents,
    // R34 E6: Regime transition readiness diagnostic
    transitionReadiness: readinessBeats > 0 ? {
      gapMin: Number(readinessGapMin.toFixed(4)),
      gapMax: Number(readinessGapMax.toFixed(4)),
      gapAvg: Number((readinessGapSum / readinessBeats).toFixed(4)),
      velocityBlockedBeats: readinessVelocityBlockedBeats,
      totalBeats: readinessBeats,
      velocityBlockedRate: Number((readinessVelocityBlockedBeats / readinessBeats).toFixed(4)),
      finalThresholdScale: readinessLastScale,
      evolvingBeats,
      coherentBeats,
      runCoherentBeats,
      maxCoherentBeats,
      runBeatCount,
      runTickCount: runBeatCount,
      runCoherentShare: Number(runCoherentShare.toFixed(4)),
      runTransitionCount,
      forcedBreakCount,
      forcedRegime,
      forcedRegimeBeatsRemaining,
      forcedOverrideBeats,
      lastForcedReason,
      lastForcedTriggerStreak,
      lastForcedTriggerBeat,
      cadenceMonopolyPressure: Number(cadenceMonopolyPressure.toFixed(4)),
      cadenceMonopolyActive,
      cadenceMonopolyReason,
      rawExploringShare: Number(rawExploringShare.toFixed(4)),
      rawEvolvingShare: Number(rawEvolvingShare.toFixed(4)),
      rawNonCoherentOpportunityShare: Number(rawNonCoherentOpportunityShare.toFixed(4)),
      resolvedNonCoherentShare: Number(resolvedNonCoherentShare.toFixed(4)),
      opportunityGap: Number(opportunityGap.toFixed(4)),
      tickSource: 'profiler-recorder',
      // R35 E5: Exploring-block diagnostic breakdown
      exploringBlock: exploringBlockCounts,
      coherentBlock: coherentBlockCounts,
      // R36 E4: Raw regime counts before hysteresis
      rawRegimeCounts,
      runRawRegimeCounts,
      runResolvedRegimeCounts,
      // R37 E6: Max consecutive streak per raw regime
      rawRegimeMaxStreak,
      // R37 E5: effectiveDim histogram (percentiles)
      effectiveDimHistogram: effectiveDimValues.length > 0 ? (() => {
        const sorted = effectiveDimValues.slice().sort((a, b) => a - b);
        const pctl = (p) => {
          const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
          return Number(sorted[idx].toFixed(4));
        };
        return { p10: pctl(0.10), p25: pctl(0.25), p50: pctl(0.50), p75: pctl(0.75), p90: pctl(0.90), min: pctl(0), max: pctl(1), count: sorted.length };
      })() : null
    } : null,
    // R35 E6: Per-pair exceedance beat counts
    pairExceedanceBeats: Object.fromEntries(
      Object.entries(pairExceedanceBeats).map(([pair, count]) => [pair, count])
    ),
    exceedanceComposite: {
      uniqueBeats: uniqueExceedanceBeats,
      uniqueRate: entries.length > 0 ? Number((uniqueExceedanceBeats / entries.length).toFixed(4)) : 0,
      totalPairExceedanceBeats: Object.values(pairExceedanceBeats).reduce((sum, value) => sum + value, 0),
      topPairs: exceedancePairsSorted.slice(0, 3)
    },
    // R58 E6: Guard/coupling interaction diagnostic
    guardCouplingInteraction: (() => {
      const gExcRate = guardedBeatCount > 0 ? guardedExceedanceBeats / guardedBeatCount : 0;
      const uExcRate = unguardedBeatCount > 0 ? unguardedExceedanceBeats / unguardedBeatCount : 0;
      const allPairKeys = [...new Set([...Object.keys(guardedCouplingAbs), ...Object.keys(unguardedCouplingAbs)])];
      const perPair = {};
      for (let k = 0; k < allPairKeys.length; k++) {
        const pk = allPairKeys[k];
        const g = guardedCouplingAbs[pk];
        const u = unguardedCouplingAbs[pk];
        const gAvg = g && g.count > 0 ? g.sum / g.count : 0;
        const uAvg = u && u.count > 0 ? u.sum / u.count : 0;
        perPair[pk] = {
          guardedAvg: Number(gAvg.toFixed(4)),
          unguardedAvg: Number(uAvg.toFixed(4)),
          delta: Number((gAvg - uAvg).toFixed(4))
        };
      }
      return {
        guardedBeats: guardedBeatCount,
        unguardedBeats: unguardedBeatCount,
        guardedExceedanceRate: Number(gExcRate.toFixed(4)),
        unguardedExceedanceRate: Number(uExcRate.toFixed(4)),
        exceedanceDelta: Number((gExcRate - uExcRate).toFixed(4)),
        perPair
      };
    })(),
    tailRecovery,
    cadenceMonopoly,
    phaseTelemetry,
    telemetryHealth,
    progressIntegrity,
    adaptiveTelemetryReconciliation,
    nonNudgeableGains,
    trustDominance,
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
    })(),
    // R66 E6: Mid-run diagnostic snapshots (section-boundary state arc)
    diagnosticArc: diagnosticArc.length > 0 ? diagnosticArc : null
  };
}

function main() {
  const tracePath = path.join(process.cwd(), 'metrics', 'trace.jsonl');
  const summaryPath = path.join(process.cwd(), 'metrics', 'trace-summary.json');
  const manifestPath = path.join(process.cwd(), 'metrics', 'system-manifest.json');

  function clearStaleSummary(reason) {
    if (!fs.existsSync(summaryPath)) return;
    fs.unlinkSync(summaryPath);
    console.warn('Acceptable warning: trace-summary: ' + reason + ', removed stale trace-summary.json.');
  }

  if (!fs.existsSync(tracePath)) {
    clearStaleSummary('trace file missing');
    console.log('trace-summary: trace file not found, skipping (run with --trace to generate metrics/trace.jsonl).');
    return;
  }

  const raw = fs.readFileSync(tracePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    clearStaleSummary('trace.jsonl is empty');
    console.warn('Acceptable warning: trace-summary: trace.jsonl is empty, skipping.');
    return;
  }

  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const entry = parseLine(lines[i], i);
    if (entry !== null) entries.push(entry);
  }

  if (entries.length === 0) {
    clearStaleSummary('trace.jsonl has no valid entries');
    console.warn('Acceptable warning: trace-summary: no valid entries in trace.jsonl, skipping.');
    return;
  }

  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;
  const summary = summarizeTrace(entries, manifest);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`trace-summary: ${entries.length} entries -> metrics/trace-summary.json`);
}

main();
