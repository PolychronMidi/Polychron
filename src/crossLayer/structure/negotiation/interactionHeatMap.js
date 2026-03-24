// src/crossLayer/interactionHeatMap.js - Passive cross-layer interaction observer.
// Tracks which cross-layer systems fired each beat and how strongly. Over time,
// builds an "interaction profile" for the piece. When interactions are dense,
// signals to dial back; when sparse, signals to ramp up.
// Provides diagnostic visibility into cross-layer system effectiveness.

interactionHeatMap = (() => {
  const V = validator.create('interactionHeatMap');
  const WINDOW_SIZE = 64; // rolling window of beats to track
  const HIGH_DENSITY_THRESHOLD = 0.7;
  const LOW_DENSITY_THRESHOLD = 0.2;
  const SYSTEMS = Object.values(trustSystems.heatMapSystems);

  /**
   * @typedef {{ systems: Record<string, number>, totalFirings: number, absTimeMs: number }} BeatSnapshot
   */

  /** @type {BeatSnapshot[]} */
  const history = [];
  let historyTotalFirings = 0;
  /** @type {Record<string, number>} */
  let systemHeatTotals = /** @type {Record<string, number>} */ ({});
  for (let i = 0; i < SYSTEMS.length; i++) {
    systemHeatTotals[SYSTEMS[i]] = 0;
  }

  /** @type {Record<string, number>} current beat accumulator */
  let currentBeat = /** @type {Record<string, number>} */ ({});
  let currentBeatTotalFirings = 0;
  /** @type {Map<string, { systems: Record<string, number>, totalFirings: number }>} */
  const deferredByKey = new Map();

  /**
   * @param {BeatSnapshot} snapshot
   */
  function pushHistorySnapshot(snapshot) {
    history.push(snapshot);
    historyTotalFirings += snapshot.totalFirings;
    const names = Object.keys(snapshot.systems);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      systemHeatTotals[name] = (systemHeatTotals[name] || 0) + snapshot.systems[name];
    }
    if (history.length > WINDOW_SIZE) {
      const removed = history.shift();
      if (removed) {
        historyTotalFirings -= removed.totalFirings;
        const removedNames = Object.keys(removed.systems);
        for (let i = 0; i < removedNames.length; i++) {
          const name = removedNames[i];
          systemHeatTotals[name] = (systemHeatTotals[name] || 0) - removed.systems[name];
        }
      }
    }
  }

  /**
   * Record a system firing in the current beat.
   * @param {string} systemName - one of the SYSTEMS names
   * @param {number} intensity - 0-1 normalized strength of the interaction
   */
  function record(systemName, intensity) {
    const clampedIntensity = clamp(intensity, 0, 1);
    if (!currentBeat[systemName]) currentBeat[systemName] = 0;
    currentBeat[systemName] += clampedIntensity;
    currentBeatTotalFirings += clampedIntensity;
  }

  /**
   * Flush the current beat snapshot into history. Call once per beat.
   * @param {number} absTimeMs
   */
  function flushBeat(absTimeMs) {
    pushHistorySnapshot({ systems: { ...currentBeat }, totalFirings: currentBeatTotalFirings, absTimeMs });
    currentBeat = /** @type {Record<string, number>} */ ({});
    currentBeatTotalFirings = 0;
  }

  /**
   * Defer current accumulated beat under a key (typically L1 side of a pair).
   * @param {string} beatKey
   */
  function deferBeat(beatKey) {
    V.assertNonEmptyString(beatKey, 'beatKey');
    const systems = { ...currentBeat };
    deferredByKey.set(beatKey, { systems, totalFirings: currentBeatTotalFirings });
    currentBeat = /** @type {Record<string, number>} */ ({});
    currentBeatTotalFirings = 0;
  }

  /**
   * Flush pair by merging deferred + current under one snapshot (typically L2 side).
   * @param {number} absTimeMs
   * @param {string} beatKey
   */
  function flushBeatPair(absTimeMs, beatKey) {
    V.assertNonEmptyString(beatKey, 'beatKey');
    const deferred = deferredByKey.get(beatKey);
    const merged = /** @type {Record<string, number>} */ ({});
    let totalFirings = currentBeatTotalFirings;

    if (deferred) {
      const deferredNames = Object.keys(deferred.systems);
      for (let i = 0; i < deferredNames.length; i++) {
        const name = deferredNames[i];
        merged[name] = (merged[name] || 0) + deferred.systems[name];
      }
      totalFirings += deferred.totalFirings;
      deferredByKey.delete(beatKey);
    }
    const currentNames = Object.keys(currentBeat);
    for (let i = 0; i < currentNames.length; i++) {
      const name = currentNames[i];
      merged[name] = (merged[name] || 0) + currentBeat[name];
    }

    pushHistorySnapshot({ systems: merged, totalFirings, absTimeMs });
    currentBeat = /** @type {Record<string, number>} */ ({});
    currentBeatTotalFirings = 0;
  }

  /**
   * Flush any deferred orphan beats when pairing can't be completed.
   * @param {number} absTimeMs
   */
  function flushDeferredOrphans(absTimeMs) {
    for (const [beatKey, deferred] of deferredByKey.entries()) {
      pushHistorySnapshot({ systems: { ...deferred.systems }, totalFirings: deferred.totalFirings, absTimeMs });
      deferredByKey.delete(beatKey);
    }
  }

  /**
   * Get interaction density over the rolling window. 0 = no interactions, 1 = every system firing every beat.
   * @returns {number} normalized density 0-1
   */
  function getDensity() {
    if (history.length === 0) return 0;
    const maxPossible = SYSTEMS.length * history.length;
    return clamp(historyTotalFirings / maxPossible, 0, 1);
  }

  /**
   * Get per-system heatmap: how often each system has fired in the window.
   * @returns {Record<string, number>} system name - normalized frequency 0-1
   */
  function getSystemHeat() {
    const heat = /** @type {Record<string, number>} */ ({});
    for (const sys of SYSTEMS) heat[sys] = 0;
    if (history.length === 0) return heat;
    const len = history.length;
    for (let i = 0; i < SYSTEMS.length; i++) {
      const sys = SYSTEMS[i];
      heat[sys] = clamp((systemHeatTotals[sys] || 0) / len, 0, 1);
    }
    return heat;
  }

  /**
   * Get breathing recommendation: should cross-layer activity increase or decrease?
   * @returns {{ recommendation: 'increase'|'maintain'|'decrease', density: number, beatsTracked: number }}
   */
  function getBreathingRecommendation() {
    const density = getDensity();
    const beatsTracked = history.length;
    if (density > HIGH_DENSITY_THRESHOLD) {
      return { recommendation: 'decrease', density, beatsTracked };
    }
    if (density < LOW_DENSITY_THRESHOLD) {
      return { recommendation: 'increase', density, beatsTracked };
    }
    return { recommendation: 'maintain', density, beatsTracked };
  }

  /**
   * Get the trend direction: is interaction density rising or falling?
   * @returns {{ trend: 'rising'|'falling'|'stable', slope: number }}
   */
  function getTrend() {
    if (history.length < 8) return { trend: 'stable', slope: 0 };
    const half = m.floor(history.length / 2);
    let firstSum = 0;
    let secondSum = 0;
    for (let i = 0; i < history.length; i++) {
      if (i < half) firstSum += history[i].totalFirings;
      else secondSum += history[i].totalFirings;
    }
    const avgFirst = firstSum / half;
    const avgSecond = secondSum / (history.length - half);
    const slope = avgSecond - avgFirst;
    if (slope > 0.3) return { trend: 'rising', slope };
    if (slope < -0.3) return { trend: 'falling', slope };
    return { trend: 'stable', slope };
  }

  function reset() {
    history.length = 0;
    currentBeat = /** @type {Record<string, number>} */ ({});
    currentBeatTotalFirings = 0;
    historyTotalFirings = 0;
    systemHeatTotals = /** @type {Record<string, number>} */ ({});
    for (let i = 0; i < SYSTEMS.length; i++) {
      systemHeatTotals[SYSTEMS[i]] = 0;
    }
    deferredByKey.clear();
  }

  return {
    record,
    flushBeat,
    deferBeat,
    flushBeatPair,
    flushDeferredOrphans,
    getDensity,
    getSystemHeat,
    getBreathingRecommendation,
    getTrend,
    reset
  };
})();
crossLayerRegistry.register('interactionHeatMap', interactionHeatMap, ['all', 'section']);
