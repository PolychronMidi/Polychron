// src/conductor/IntervalExpansionContractor.js - Intervallic vocabulary expansion/contraction.
// Tracks whether the range of interval sizes used is expanding (wider leaps
// emerging) or contracting (tighter steps dominating) over time.
// Density bias to allow expansion room or encourage consolidation.
// Pure query API — no side effects.

IntervalExpansionContractor = (() => {
  const V = Validator.create('IntervalExpansionContractor');
  const MAX_SNAPSHOTS = 16;
  /** @type {Array<{ avgInterval: number, maxInterval: number, time: number }>} */
  const intervalSnapshots = [];

  /**
   * Record an interval vocabulary snapshot from recent material.
   * @param {number} absTime
   */
  function recordSnapshot(absTime) {
    V.requireFinite(absTime, 'absTime');

    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: 4 });

    if (notes.length < 3) return;

    let totalInterval = 0;
    let maxInterval = 0;
    let count = 0;

    for (let i = 1; i < notes.length; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : -1;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : -1;
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
  function getExpansionSignal() {
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
    if (avgIntervalTrend > 1.5) trend = 'expanding';
    else if (avgIntervalTrend < -1.5) trend = 'contracting';

    // Density bias: rapid expansion → slight reduction to give melodic room;
    // extreme contraction → slight increase to encourage variety
    let densityBias = 1;
    if (avgIntervalTrend > 2) {
      densityBias = 0.96; // expanding fast → give room
    } else if (avgIntervalTrend < -2) {
      densityBias = 1.04; // contracting → encourage variety
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

  ConductorIntelligence.registerDensityBias('IntervalExpansionContractor', () => IntervalExpansionContractor.getDensityBias(), 0.9, 1.1);
  ConductorIntelligence.registerRecorder('IntervalExpansionContractor', (ctx) => { IntervalExpansionContractor.recordSnapshot(ctx.absTime); });
  ConductorIntelligence.registerStateProvider('IntervalExpansionContractor', () => {
    const s = IntervalExpansionContractor.getExpansionSignal();
    return { intervalExpansionTrend: s ? s.trend : 'stable' };
  });

  return {
    recordSnapshot,
    getExpansionSignal,
    getDensityBias,
    reset
  };
})();
