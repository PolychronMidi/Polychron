// src/conductor/analysisHelpers.js - Shared analysis utilities.
// Used by velocityShapeAnalyzer, durationalContourTracker, energyMomentumTracker,
// registerMigrationTracker, phraseLengthMomentumTracker, rhythmicComplexityGradient,
// structuralFormTracker.
// Pure, stateless helpers - no side effects, no ATW dependency.

moduleLifecycle.declare({
  name: 'analysisHelpers',
  subsystem: 'conductor',
  deps: [],
  provides: ['analysisHelpers'],
  init: () => {
  /**
   * Shared ATW note-window query for single-layer analysis modules.
   * @param {{ optionalFinite: (value: unknown, fallback?: number) => number }} V
   * @param {{ layer?: string, windowSeconds?: number } | undefined} opts
   * @param {number} defaultWindowSeconds
   * @returns {any[]}
   */
  function getWindowNotes(V, opts, defaultWindowSeconds) {
    const safeOpts = opts && typeof opts === 'object' ? opts : {};
    const ws = V.optionalFinite(safeOpts.windowSeconds, defaultWindowSeconds);
    return L0.query(L0_CHANNELS.note, { layer: safeOpts.layer, windowSeconds: ws });
  }

  /**
   * Shared ATW note-window query for two-layer comparison modules.
   * @param {{ optionalFinite: (value: unknown, fallback?: number) => number }} V
   * @param {number | undefined} windowSeconds
   * @param {number} defaultWindowSeconds
   * @returns {{ l1Notes: any[], l2Notes: any[] }}
   */
  function getWindowLayerPairNotes(V, windowSeconds, defaultWindowSeconds) {
    const ws = V.optionalFinite(windowSeconds, defaultWindowSeconds);
    return {
      l1Notes: L0.query(L0_CHANNELS.note, { layer: 'L1', windowSeconds: ws }),
      l2Notes: L0.query(L0_CHANNELS.note, { layer: 'L2', windowSeconds: ws })
    };
  }

  /**
   * @param {any[]} notes
   * @param {number} [defaultValue=-1]
   * @returns {number[]}
   */
  function extractMidiArray(notes, defaultValue = -1) {
    /** @type {number[]} */
    const midis = [];
    for (let i = 0; i < notes.length; i++) {
      midis.push(propertyExtractors.extractNumberOrDefault(notes[i], 'midi', defaultValue));
    }
    return midis;
  }

  /**
   * @param {any[]} notes
   * @param {number} [defaultValue=64]
   * @returns {number[]}
   */
  function extractVelocityArray(notes, defaultValue = 64) {
    /** @type {number[]} */
    const velocities = [];
    for (let i = 0; i < notes.length; i++) {
      velocities.push(propertyExtractors.extractFiniteOrDefault(notes[i], 'velocity', defaultValue));
    }
    return velocities;
  }

  /**
   * @param {number[]} values
   * @param {number} [defaultValue=0]
   * @returns {number[]}
   */
  function extractPCArray(values, defaultValue = 0) {
    /** @type {number[]} */
    const pitchClasses = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (!Number.isFinite(value)) {
        pitchClasses.push(defaultValue);
        continue;
      }
      pitchClasses.push(((value % 12) + 12) % 12);
    }
    return pitchClasses;
  }

  /**
   * Split an array of numbers in half and return the slope (avgSecond - avgFirst).
   * Standard half-split slope for detecting crescendo/decrescendo, acceleration, etc.
   * @param {number[]} values - array of numeric samples (velocities, durations, energies, etc.)
   * @returns {{ slope: number, avgFirst: number, avgSecond: number }}
   */
  function halfSplitSlope(values) {
    if (values.length < 4) return { slope: 0, avgFirst: 0, avgSecond: 0 };
    const half = m.ceil(values.length / 2);
    let sumFirst = 0;
    let sumSecond = 0;
    for (let i = 0; i < half; i++) sumFirst += values[i];
    for (let i = half; i < values.length; i++) sumSecond += values[i];
    const avgFirst = sumFirst / half;
    const avgSecond = sumSecond / (values.length - half);
    return { slope: avgSecond - avgFirst, avgFirst, avgSecond };
  }

  /**
   * Returns a query function for a tracker module. query(opts) returns the
   * notes array or null if notes.length < minNotes.
   * @param {{ optionalFinite: (value: unknown, fallback?: number) => number }} V - validator instance from the calling module
   * @param {number} windowSeconds
   * @param {{ minNotes?: number }} [options]
   * @returns {(opts?: object) => any[]|null}
   */
  function createTrackerQuery(V, windowSeconds, { minNotes = 2 } = {}) {
    return function query(opts) {
      const notes = getWindowNotes(V, opts, windowSeconds);
      if (notes.length < minNotes) return null;
      return notes;
    };
  }

  return {
    getWindowNotes,
    getWindowLayerPairNotes,
    extractMidiArray,
    extractVelocityArray,
    extractPCArray,
    halfSplitSlope,
    createTrackerQuery
  };
  },
});
