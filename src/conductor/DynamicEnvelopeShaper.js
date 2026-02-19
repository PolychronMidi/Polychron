// src/conductor/DynamicEnvelopeShaper.js - Attack/sustain/decay dynamic shape tracker.
// Analyzes the velocity contour of recent phrases to detect envelope style
// (punchy, smooth, crescendo, decrescendo). Provides a flicker modifier
// to shape the dynamic envelope character.
// Pure query API — no side effects.

DynamicEnvelopeShaper = (() => {
  const WINDOW_SECONDS = 6;

  /**
   * Analyze the dynamic envelope shape from recent note velocities.
   * @returns {{ shape: string, punchiness: number, flickerMod: number }}
   */
  function getEnvelopeSignal() {
    const notes = (typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.getNotes === 'function')
      ? AbsoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS })
      : [];

    if (notes.length < 4) {
      return { shape: 'neutral', punchiness: 0.5, flickerMod: 1 };
    }

    // Extract velocity sequence
    /** @type {number[]} */
    const velocities = [];
    for (let i = 0; i < notes.length; i++) {
      const vel = (typeof notes[i].velocity === 'number') ? notes[i].velocity : 80;
      velocities.push(vel);
    }

    // Compute consecutive velocity differences
    let totalDiff = 0;
    let absDiffSum = 0;
    let peakIdx = 0;
    let peakVel = 0;

    for (let i = 0; i < velocities.length; i++) {
      if (velocities[i] > peakVel) {
        peakVel = velocities[i];
        peakIdx = i;
      }
    }

    for (let i = 1; i < velocities.length; i++) {
      const diff = velocities[i] - velocities[i - 1];
      totalDiff += diff;
      absDiffSum += m.abs(diff);
    }

    const avgDiff = totalDiff / (velocities.length - 1);
    const avgAbsDiff = absDiffSum / (velocities.length - 1);

    // Punchiness: high abs differences = punchy, low = smooth
    const punchiness = clamp(avgAbsDiff / 30, 0, 1);

    // Detect shape
    let shape = 'neutral';
    const peakPosition = velocities.length > 1 ? peakIdx / (velocities.length - 1) : 0.5;

    if (avgDiff > 3) shape = 'crescendo';
    else if (avgDiff < -3) shape = 'decrescendo';
    else if (punchiness > 0.6) shape = 'punchy';
    else if (punchiness < 0.2) shape = 'smooth';
    else if (peakPosition > 0.3 && peakPosition < 0.7) shape = 'arch';

    // Flicker modifier: punchy → wider flicker to maintain dynamic variety;
    // smooth → tighter flicker for consistency
    let flickerMod = 1;
    if (punchiness > 0.7) {
      flickerMod = 1.12; // punchy → amplify variations
    } else if (punchiness < 0.15) {
      flickerMod = 0.9; // very smooth → dampen flicker
    }

    return { shape, punchiness, flickerMod };
  }

  /**
   * Get flicker modifier for the flickerAmplitude chain.
   * @returns {number}
   */
  function getFlickerModifier() {
    return getEnvelopeSignal().flickerMod;
  }

  return {
    getEnvelopeSignal,
    getFlickerModifier
  };
})();
