// src/conductor/ambitusMigrationTracker.js - Pitch range (ambitus) expansion/contraction.
// Tracks the overall pitch range used in recent material and its rate of change.
// Biases toward range exploration when constrained or consolidation when overspread.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'ambitusMigrationTracker',
  subsystem: 'conductor',
  deps: ['L0', 'conductorIntelligence', 'validator'],
  lazyDeps: ['analysisHelpers'],
  provides: ['ambitusMigrationTracker'],
  init: (deps) => {
  const L0 = deps.L0;
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('ambitusMigrationTracker');
  const WINDOW_SECONDS = 10;
  const MAX_HISTORY = 12;
  /** @type {Array<{ range: number, center: number, time: number }>} */
  const rangeHistory = [];

  /**
   * Analyze current ambitus from the note window.
   * @returns {{ low: number, high: number, range: number, center: number }}
   */
  function getCurrentAmbitus() {
    const notes = L0.query(L0_CHANNELS.note, { windowSeconds: WINDOW_SECONDS });

    if (notes.length === 0) {
      return { low: 60, high: 72, range: 12, center: 66 };
    }

    const midis = analysisHelpers.extractMidiArray(notes).filter((midi) => midi >= 0);
    let low = 127;
    let high = 0;
    for (let i = 0; i < midis.length; i++) {
      const midi = midis[i];
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
  function ambitusMigrationTrackerComputeAmbitusSignal() {
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

    // Density bias based on range health - continuous ramps
    // Narrow range (0-12 semitones) - ramp 1.06-1.0
    // Wide range (36-60 semitones) - ramp 1.0-0.94
    let densityBias = 1;
    if (amb.range < 12) {
      densityBias = 1.0 + (1 - clamp(amb.range / 12, 0, 1)) * 0.06;
    } else if (amb.range > 36) {
      densityBias = 1.0 - clamp((amb.range - 36) / 24, 0, 1) * 0.06;
    }

    // Register suggestion
    let registerSuggestion = 'maintain';
    if (amb.range < 10) registerSuggestion = 'explore';
    else if (amb.range > 40) registerSuggestion = 'consolidate';
    else if (trend === 'expanding') registerSuggestion = 'stabilize';
    else if (trend === 'contracting') registerSuggestion = 'release';

    return { range: amb.range, trend, densityBias, registerSuggestion };
  }

  const ambitusMigrationTrackerCache = beatCache.create(ambitusMigrationTrackerComputeAmbitusSignal);

  /**
   * Get the ambitus signal with migration analysis (cached per beat).
   * @returns {{ range: number, trend: string, densityBias: number, registerSuggestion: string }}
   */
  function getAmbitusSignal() { return ambitusMigrationTrackerCache.get(); }

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

  // R13 E2: Flicker bias from ambitus migration. When pitch range is
  // contracting (narrowing), inject flicker variation (up to 1.10) to
  // compensate for melodic narrowness with timbral richness. When
  // expanding, reduce flicker (down to 0.95) to let melodic variety
  // speak without timbral clutter. Static range returns neutral.
  function getFlickerBias() {
    const signal = getAmbitusSignal();
    if (signal.trend === 'contracting') return 1.10;
    if (signal.trend === 'expanding') return 0.95;
    return 1.0;
  }

  conductorIntelligence.registerDensityBias('ambitusMigrationTracker', () => ambitusMigrationTracker.getDensityBias(), 0.9, 1.1);
  conductorIntelligence.registerFlickerModifier('ambitusMigrationTracker', () => ambitusMigrationTracker.getFlickerBias(), 0.93, 1.12);
  conductorIntelligence.registerRecorder('ambitusMigrationTracker', (ctx) => { ambitusMigrationTracker.recordSnapshot(ctx.absTime); });
  conductorIntelligence.registerStateProvider('ambitusMigrationTracker', () => {
    const s = ambitusMigrationTracker.getAmbitusSignal();
    return {
      ambitusRange: s ? s.range : 24,
      ambitusTrend: s ? s.trend : 'stable',
      ambitusRegisterSuggestion: s ? s.registerSuggestion : 'maintain'
    };
  });
  conductorIntelligence.registerModule('ambitusMigrationTracker', { reset }, ['section']);

  return {
    getCurrentAmbitus,
    recordSnapshot,
    getAmbitusSignal,
    getDensityBias,
    getFlickerBias,
    reset
  };
  },
});
