// src/conductor/HarmonicVelocityMonitor.js - Harmonic change rate vs energy arc.
// Flags harmony moving too fast in calm passages or stalling at climaxes.
// Pure query API â€” scales HarmonicRhythmTracker thresholds and journey boldness.

HarmonicVelocityMonitor = (() => {
  const V = Validator.create('harmonicVelocityMonitor');
  const WINDOW_SECONDS = 6;

  /**
   * Get number of chord changes in the recent window.
   * @param {number} [windowSeconds]
   * @returns {{ changesPerSecond: number, total: number }}
   */
  function getHarmonicVelocity(windowSeconds) {
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
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
    const compositeIntensity = ConductorState.getField('compositeIntensity');

    // Expected changes/sec at given intensity: calm ~0.2, intense ~1.2
    const expectedRate = 0.2 + Number(compositeIntensity) * 1.0;
    const mismatch = vel.changesPerSecond - expectedRate;

    let diagnosis = 'balanced';
    if (mismatch > 0.3) diagnosis = 'harmony-too-fast';
    if (mismatch < -0.2) diagnosis = 'harmony-stalling';

    return { mismatch, diagnosis };
  }

  /**
   * Get a harmonic-change threshold bias.
   * Continuous ramp based on mismatch magnitude — avoids step-function
   * flip-flops that contribute to oscillating regime dynamics.
   * Harmony too fast → raise threshold (slow it down); too slow → lower it.
   * @returns {number} - 0.7 to 1.4
   */
  function getChangeThresholdBias() {
    const diag = diagnoseEnergyMatch();
    // Continuous ramp: mismatch 0 → 1.0, positive → up to 1.15, negative → down to 0.88
    if (diag.mismatch > 0) {
      // Ramp from 1.0 at mismatch=0 to 1.15 at mismatch=0.8+
      return 1.0 + clamp(diag.mismatch / 0.8, 0, 1) * 0.15;
    }
    // Ramp from 1.0 at mismatch=0 to 0.88 at mismatch=-0.6-
    return 1.0 + clamp(diag.mismatch / 0.6, -1, 0) * 0.12;
  }

  /**
   * Get a journey boldness bias.
   * Continuous ramp — stalling harmony → bolder moves; rushing → more conservative.
   * @returns {number} - 0.7 to 1.3
   */
  function getJourneyBoldnessBias() {
    const diag = diagnoseEnergyMatch();
    if (diag.mismatch < 0) {
      // Ramp from 1.0 at mismatch=0 to 1.12 at mismatch=-0.6-
      return 1.0 + clamp(diag.mismatch / -0.6, 0, 1) * 0.12;
    }
    // Ramp from 1.0 at mismatch=0 to 0.88 at mismatch=0.8+
    return 1.0 - clamp(diag.mismatch / 0.8, 0, 1) * 0.12;
  }

  ConductorIntelligence.registerTensionBias('HarmonicVelocityMonitor', () => HarmonicVelocityMonitor.getChangeThresholdBias(), 0.85, 1.2);

  return {
    getHarmonicVelocity,
    diagnoseEnergyMatch,
    getChangeThresholdBias,
    getJourneyBoldnessBias
  };
})();
