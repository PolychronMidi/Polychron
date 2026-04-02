// src/conductor/intervalExpansionContractor.js - Intervallic vocabulary expansion/contraction.
// Tracks whether the range of interval sizes used is expanding (wider leaps
// emerging) or contracting (tighter steps dominating) over time.
// Density bias to allow expansion room or encourage consolidation.
// Pure query API - no side effects.

intervalExpansionContractor = (() => {
  const V = validator.create('intervalExpansionContractor');
  const MAX_SNAPSHOTS = 16;
  /** @type {Array<{ avgInterval: number, maxInterval: number, time: number }>} */
  const intervalSnapshots = [];

  // Beat-level cache: getExpansionSignal is called 2x per beat (densityBias + stateProvider)
  const intervalExpansionContractorCache = beatCache.create(() => intervalExpansionContractorGetExpansionSignal());

  /**
   * Record an interval vocabulary snapshot from recent material.
   * @param {number} absTime
   */
  function recordSnapshot(absTime) {
    V.requireFinite(absTime, 'absTime');

    const notes = L0.query('note', { windowSeconds: 4 });
    const midis = analysisHelpers.extractMidiArray(notes);

    if (midis.length < 3) return;

    let totalInterval = 0;
    let maxInterval = 0;
    let count = 0;

    for (let i = 1; i < midis.length; i++) {
      const prev = midis[i - 1];
      const curr = midis[i];
      if (prev < 0 || curr < 0) continue;
      const interval = m.abs(curr - prev);
      if (interval > 0) {
        totalInterval += interval;
        if (interval > maxInterval) maxInterval = interval;
        count++;
      }
    }

    if (count > 0) {
      intervalSnapshots.push({ avgInterval: totalInterval / count, maxInterval, time: absTime });
      if (intervalSnapshots.length > MAX_SNAPSHOTS) intervalSnapshots.shift();
    }
  }

  /**
   * Detect expansion/contraction trend.
   * @returns {{ trend: string, densityBias: number, avgIntervalTrend: number }}
   */
  function getExpansionSignal() { return intervalExpansionContractorCache.get(); }

  /** @private */
  function intervalExpansionContractorGetExpansionSignal() {
    if (intervalSnapshots.length < 4) {
      return { trend: 'stable', densityBias: 1, avgIntervalTrend: 0 };
    }

    // Compare recent vs. older average interval size
    const recentStart = m.max(0, intervalSnapshots.length - 3);
    let recentSum = 0;
    let recentCount = 0;
    for (let i = recentStart; i < intervalSnapshots.length; i++) {
      recentSum += intervalSnapshots[i].avgInterval;
      recentCount++;
    }
    const recentAvg = recentSum / recentCount;

    const olderEnd = m.min(3, intervalSnapshots.length - 3);
    let olderSum = 0;
    let olderCount = 0;
    for (let i = 0; i < olderEnd; i++) {
      olderSum += intervalSnapshots[i].avgInterval;
      olderCount++;
    }
    const olderAvg = olderCount > 0 ? olderSum / olderCount : recentAvg;

    const avgIntervalTrend = recentAvg - olderAvg;

    let trend = 'stable';
    // R27 E2: Narrowed thresholds from +/-1.5 to +/-0.8. R26 showed
    // tension at 1.0 (stable intervals) because typical avgIntervalTrend
    // rarely exceeds +/-1.5 in well-balanced compositions.
    if (avgIntervalTrend > 0.8) trend = 'expanding';
    else if (avgIntervalTrend < -0.8) trend = 'contracting';

    // Density bias: rapid expansion - slight reduction to give melodic room;
    // extreme contraction - slight increase to encourage variety
    let densityBias = 1;
    // R6 E3: Widen density bias from 4% to 8%. Stronger response to
    // intervallic trends creates more melodic diversity: wider leaps get
    // more room, stepwise motion gets encouraged toward variety.
    // R27 E2: Aligned density bias thresholds with narrowed trend thresholds.
    if (avgIntervalTrend > 1.2) {
      densityBias = 0.92; // expanding fast - give room
    } else if (avgIntervalTrend < -1.2) {
      densityBias = 1.08; // contracting - encourage variety
    }

    return { trend, densityBias, avgIntervalTrend };
  }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getExpansionSignal().densityBias;
  }

  /** Reset tracking. */
  function reset() {
    intervalSnapshots.length = 0;
  }

  // R26 E5: Tension bias from intervallic expansion/contraction. Expanding
  // intervals (wider leaps appearing) correlate with rising dramatic
  // intensity and should boost tension. Contracting intervals (tighter
  // steps) signal settling/resolution and should relax tension. Creates
  // cross-domain melodic->harmonic coupling.
  /**
   * Get tension multiplier from interval expansion trajectory.
   * @returns {number}
   */
  function getTensionBias() {
    const s = getExpansionSignal();
    if (s.trend === 'expanding') return 1.05;
    if (s.trend === 'contracting') return 0.96;
    return 1.0;
  }

  conductorIntelligence.registerDensityBias('intervalExpansionContractor', () => intervalExpansionContractor.getDensityBias(), 0.9, 1.1);
  conductorIntelligence.registerTensionBias('intervalExpansionContractor', () => intervalExpansionContractor.getTensionBias(), 0.96, 1.05);
  conductorIntelligence.registerRecorder('intervalExpansionContractor', (ctx) => { intervalExpansionContractor.recordSnapshot(ctx.absTime); });
  conductorIntelligence.registerStateProvider('intervalExpansionContractor', () => {
    const s = intervalExpansionContractor.getExpansionSignal();
    return { intervalExpansionTrend: s ? s.trend : 'stable' };
  });
  conductorIntelligence.registerModule('intervalExpansionContractor', { reset }, ['section']);

  return {
    recordSnapshot,
    getExpansionSignal,
    getDensityBias,
    getTensionBias,
    reset
  };
})();
