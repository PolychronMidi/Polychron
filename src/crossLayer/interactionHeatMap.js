// src/crossLayer/interactionHeatMap.js — Passive cross-layer interaction observer.
// Tracks which cross-layer systems fired each beat and how strongly. Over time,
// builds an "interaction profile" for the piece. When interactions are dense,
// signals to dial back; when sparse, signals to ramp up.
// Provides diagnostic visibility into cross-layer system effectiveness.

InteractionHeatMap = (() => {
  const WINDOW_SIZE = 64; // rolling window of beats to track
  const HIGH_DENSITY_THRESHOLD = 0.7;
  const LOW_DENSITY_THRESHOLD = 0.2;
  const SYSTEMS = [
    'stutterContagion', 'convergence', 'temporalGravity',
    'velocityInterference', 'feedbackOscillator', 'cadenceAlignment',
    'phaseLock', 'spectralComplement', 'roleSwap', 'motifEcho', 'emergentDownbeat'
  ];

  /**
   * @typedef {{ systems: Record<string, number>, totalFirings: number, absTimeMs: number }} BeatSnapshot
   */

  /** @type {BeatSnapshot[]} */
  const history = [];

  /** @type {Record<string, number>} current beat accumulator */
  let currentBeat = /** @type {Record<string, number>} */ ({});
  /** @type {Map<string, { systems: Record<string, number>, totalFirings: number }>} */
  const deferredByKey = new Map();

  /**
   * Record a system firing in the current beat.
   * @param {string} systemName - one of the SYSTEMS names
   * @param {number} intensity - 0-1 normalized strength of the interaction
   */
  function record(systemName, intensity) {
    if (!currentBeat[systemName]) currentBeat[systemName] = 0;
    currentBeat[systemName] += clamp(intensity, 0, 1);
  }

  /**
   * Flush the current beat snapshot into history. Call once per beat.
   * @param {number} absTimeMs
   */
  function flushBeat(absTimeMs) {
    const totalFirings = Object.values(currentBeat).reduce((s, v) => s + v, 0);
    history.push({ systems: { ...currentBeat }, totalFirings, absTimeMs });
    if (history.length > WINDOW_SIZE) history.shift();
    currentBeat = /** @type {Record<string, number>} */ ({});
  }

  /**
   * Defer current accumulated beat under a key (typically L1 side of a pair).
   * @param {string} beatKey
   */
  function deferBeat(beatKey) {
    if (typeof beatKey !== 'string' || beatKey.length === 0) {
      throw new Error('InteractionHeatMap.deferBeat: beatKey must be a non-empty string');
    }
    const systems = { ...currentBeat };
    const totalFirings = Object.values(systems).reduce((s, v) => s + v, 0);
    deferredByKey.set(beatKey, { systems, totalFirings });
    currentBeat = /** @type {Record<string, number>} */ ({});
  }

  /**
   * Flush pair by merging deferred + current under one snapshot (typically L2 side).
   * @param {number} absTimeMs
   * @param {string} beatKey
   */
  function flushBeatPair(absTimeMs, beatKey) {
    if (typeof beatKey !== 'string' || beatKey.length === 0) {
      throw new Error('InteractionHeatMap.flushBeatPair: beatKey must be a non-empty string');
    }
    const deferred = deferredByKey.get(beatKey);
    const merged = /** @type {Record<string, number>} */ ({});

    if (deferred) {
      Object.keys(deferred.systems).forEach((name) => {
        merged[name] = (merged[name] || 0) + deferred.systems[name];
      });
      deferredByKey.delete(beatKey);
    }
    Object.keys(currentBeat).forEach((name) => {
      merged[name] = (merged[name] || 0) + currentBeat[name];
    });

    const totalFirings = Object.values(merged).reduce((s, v) => s + v, 0);
    history.push({ systems: merged, totalFirings, absTimeMs });
    if (history.length > WINDOW_SIZE) history.shift();
    currentBeat = /** @type {Record<string, number>} */ ({});
  }

  /**
   * Flush any deferred orphan beats when pairing can't be completed.
   * @param {number} absTimeMs
   */
  function flushDeferredOrphans(absTimeMs) {
    for (const [beatKey, deferred] of deferredByKey.entries()) {
      history.push({ systems: { ...deferred.systems }, totalFirings: deferred.totalFirings, absTimeMs });
      if (history.length > WINDOW_SIZE) history.shift();
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
    const total = history.reduce((s, snap) => s + snap.totalFirings, 0);
    return clamp(total / maxPossible, 0, 1);
  }

  /**
   * Get per-system heatmap: how often each system has fired in the window.
   * @returns {Record<string, number>} system name → normalized frequency 0-1
   */
  function getSystemHeat() {
    const heat = /** @type {Record<string, number>} */ ({});
    for (const sys of SYSTEMS) heat[sys] = 0;
    if (history.length === 0) return heat;
    for (const snap of history) {
      for (const sys of SYSTEMS) {
        if (snap.systems[sys]) heat[sys] += snap.systems[sys];
      }
    }
    const len = history.length;
    for (const sys of SYSTEMS) heat[sys] = clamp(heat[sys] / len, 0, 1);
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
    const half = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, half);
    const secondHalf = history.slice(half);
    const avgFirst = firstHalf.reduce((s, snap) => s + snap.totalFirings, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, snap) => s + snap.totalFirings, 0) / secondHalf.length;
    const slope = avgSecond - avgFirst;
    if (slope > 0.3) return { trend: 'rising', slope };
    if (slope < -0.3) return { trend: 'falling', slope };
    return { trend: 'stable', slope };
  }

  function reset() {
    history.length = 0;
    currentBeat = /** @type {Record<string, number>} */ ({});
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
