// src/conductor/HarmonicVelocityMonitor.js - Harmonic change rate vs energy arc.
// Flags harmony moving too fast in calm passages or stalling at climaxes.
// Pure query API — scales HarmonicRhythmTracker thresholds and journey boldness.

HarmonicVelocityMonitor = (() => {
  const WINDOW_SECONDS = 6;

  /**
   * Get number of chord changes in the recent window.
   * @param {number} [windowSeconds]
   * @returns {{ changesPerSecond: number, total: number }}
   */
  function getHarmonicVelocity(windowSeconds) {
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const chords = AbsoluteTimeWindow.getChords({ windowSeconds: ws });
    if (chords.length < 2) return { changesPerSecond: 0, total: chords.length };

    const first = chords[0];
    const last = chords[chords.length - 1];
    if (!first || !last) return { changesPerSecond: 0, total: chords.length };

    const span = last.time - first.time;
    if (span <= 0) return { changesPerSecond: 0, total: chords.length };

    return { changesPerSecond: (chords.length - 1) / span, total: chords.length };
  }

  /**
   * Compare harmonic velocity to the current energy arc.
   * Returns a mismatch score: positive = harmony too fast for energy, negative = too slow.
   * @returns {{ mismatch: number, diagnosis: string }}
   */
  function diagnoseEnergyMatch() {
    const vel = getHarmonicVelocity();
    const compositeIntensity = (typeof ConductorState !== 'undefined' && ConductorState && typeof ConductorState.getState === 'function')
      ? (ConductorState.getState().compositeIntensity || 0.5)
      : 0.5;

    // Expected changes/sec at given intensity: calm ~0.1, intense ~0.6
    const expectedRate = 0.1 + compositeIntensity * 0.5;
    const mismatch = vel.changesPerSecond - expectedRate;

    let diagnosis = 'balanced';
    if (mismatch > 0.2) diagnosis = 'harmony-too-fast';
    if (mismatch < -0.15) diagnosis = 'harmony-stalling';

    return { mismatch, diagnosis };
  }

  /**
   * Get a harmonic-change threshold bias.
   * Harmony too fast → raise threshold (slow it down); too slow → lower it.
   * @returns {number} - 0.7 to 1.4
   */
  function getChangeThresholdBias() {
    const diag = diagnoseEnergyMatch();
    if (diag.diagnosis === 'harmony-too-fast') return 1.3;
    if (diag.diagnosis === 'harmony-stalling') return 0.75;
    return 1.0;
  }

  /**
   * Get a journey boldness bias.
   * Stalling harmony → bolder moves; rushing → more conservative.
   * @returns {number} - 0.7 to 1.3
   */
  function getJourneyBoldnessBias() {
    const diag = diagnoseEnergyMatch();
    if (diag.diagnosis === 'harmony-stalling') return 1.25;
    if (diag.diagnosis === 'harmony-too-fast') return 0.75;
    return 1.0;
  }

  ConductorIntelligence.registerTensionBias('HarmonicVelocityMonitor', () => HarmonicVelocityMonitor.getChangeThresholdBias(), 0.7, 1.4);

  return {
    getHarmonicVelocity,
    diagnoseEnergyMatch,
    getChangeThresholdBias,
    getJourneyBoldnessBias
  };
})();
