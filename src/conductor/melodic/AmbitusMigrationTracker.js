// src/conductor/AmbitusMigrationTracker.js - Pitch range (ambitus) expansion/contraction.
// Tracks the overall pitch range used in recent material and its rate of change.
// Biases toward range exploration when constrained or consolidation when overspread.
// Pure query API — no side effects.

AmbitusMigrationTracker = (() => {
  const V = Validator.create('AmbitusMigrationTracker');
  const WINDOW_SECONDS = 10;
  const MAX_HISTORY = 12;
  /** @type {Array<{ range: number, center: number, time: number }>} */
  const rangeHistory = [];

  /**
   * Analyze current ambitus from the note window.
   * @returns {{ low: number, high: number, range: number, center: number }}
   */
  function getCurrentAmbitus() {
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS });

    if (notes.length === 0) {
      return { low: 60, high: 72, range: 12, center: 66 };
    }

    let low = 127;
    let high = 0;
    for (let i = 0; i < notes.length; i++) {
      const midi = (typeof notes[i].midi === 'number') ? notes[i].midi : -1;
      if (midi < 0) continue;
      if (midi < low) low = midi;
      if (midi > high) high = midi;
    }

    if (low > high) { low = 60; high = 72; }
    return { low, high, range: high - low, center: m.round((low + high) / 2) };
  }

  /**
   * Record a snapshot for trend tracking.
   * @param {number} absTime
   */
  function recordSnapshot(absTime) {
    V.requireFinite(absTime, 'absTime');
    const amb = getCurrentAmbitus();
    rangeHistory.push({ range: amb.range, center: amb.center, time: absTime });
    if (rangeHistory.length > MAX_HISTORY) rangeHistory.shift();
  }

  /**
   * Get the ambitus signal with migration analysis.
   * @returns {{ range: number, trend: string, densityBias: number, registerSuggestion: string }}
   */
  function _computeAmbitusSignal() {
    const amb = getCurrentAmbitus();

    // Determine trend from history
    let trend = 'stable';
    if (rangeHistory.length >= 3) {
      const recent = rangeHistory[rangeHistory.length - 1].range;
      const older = rangeHistory[m.max(0, rangeHistory.length - 4)].range;
      const diff = recent - older;
      if (diff > 5) trend = 'expanding';
      else if (diff < -5) trend = 'contracting';
    }

    // Density bias based on range health
    // Very narrow range (<12 semitones = 1 octave) → encourage exploration
    // Very wide range (>36 semitones = 3 octaves) → encourage consolidation
    let densityBias = 1;
    if (amb.range < 12) {
      densityBias = 1.06; // encourage notes outside current range
    } else if (amb.range > 36) {
      densityBias = 0.94; // pull back, consolidate
    }

    // Register suggestion
    let registerSuggestion = 'maintain';
    if (amb.range < 10) registerSuggestion = 'explore';
    else if (amb.range > 40) registerSuggestion = 'consolidate';
    else if (trend === 'expanding') registerSuggestion = 'stabilize';
    else if (trend === 'contracting') registerSuggestion = 'release';

    return { range: amb.range, trend, densityBias, registerSuggestion };
  }

  const _cache = beatCache.create(_computeAmbitusSignal);

  /**
   * Get the ambitus signal with migration analysis (cached per beat).
   * @returns {{ range: number, trend: string, densityBias: number, registerSuggestion: string }}
   */
  function getAmbitusSignal() { return _cache.get(); }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getAmbitusSignal().densityBias;
  }

  /** Reset tracking. */
  function reset() {
    rangeHistory.length = 0;
  }

  ConductorIntelligence.registerDensityBias('AmbitusMigrationTracker', () => AmbitusMigrationTracker.getDensityBias(), 0.9, 1.1);
  ConductorIntelligence.registerRecorder('AmbitusMigrationTracker', (ctx) => { AmbitusMigrationTracker.recordSnapshot(ctx.absTime); });
  ConductorIntelligence.registerStateProvider('AmbitusMigrationTracker', () => {
    const s = AmbitusMigrationTracker.getAmbitusSignal();
    return {
      ambitusRange: s ? s.range : 24,
      ambitusTrend: s ? s.trend : 'stable',
      ambitusRegisterSuggestion: s ? s.registerSuggestion : 'maintain'
    };
  });
  ConductorIntelligence.registerModule('AmbitusMigrationTracker', { reset }, ['section']);

  return {
    getCurrentAmbitus,
    recordSnapshot,
    getAmbitusSignal,
    getDensityBias,
    reset
  };
})();
