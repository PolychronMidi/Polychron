// src/conductor/LeapStepBalancer.js - Melodic leap vs. stepwise motion ratio tracker.
// Analyzes interval sizes in recent material and biases toward corrective balance:
// leap-heavy passages → favor steps, step-heavy → allow leaps.
// Pure query API — no side effects.

LeapStepBalancer = (() => {
  const WINDOW_SECONDS = 6;
  const LEAP_THRESHOLD = 3; // intervals > 2 semitones are leaps

  /**
   * Analyze leap/step ratio in recent material.
   * @returns {{ leapRatio: number, stepRatio: number, densityBias: number, leapBias: number, stepBias: number }}
   */
  function getBalanceSignal() {
    const notes = (typeof AbsoluteTimeWindow !== 'undefined' && AbsoluteTimeWindow && typeof AbsoluteTimeWindow.getNotes === 'function')
      ? AbsoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS })
      : [];

    if (notes.length < 3) {
      return { leapRatio: 0.5, stepRatio: 0.5, densityBias: 1, leapBias: 1, stepBias: 1 };
    }

    let leaps = 0;
    let steps = 0;
    for (let i = 1; i < notes.length; i++) {
      const prev = (typeof notes[i - 1].midi === 'number') ? notes[i - 1].midi : 60;
      const curr = (typeof notes[i].midi === 'number') ? notes[i].midi : 60;
      const interval = m.abs(curr - prev);
      if (interval >= LEAP_THRESHOLD) {
        leaps++;
      } else if (interval > 0) {
        steps++;
      }
    }

    const total = leaps + steps;
    if (total === 0) {
      return { leapRatio: 0.5, stepRatio: 0.5, densityBias: 1, leapBias: 1, stepBias: 1 };
    }

    const leapRatio = leaps / total;
    const stepRatio = steps / total;

    // Corrective biases: push toward ~40% leaps / 60% steps (balanced melodic writing)
    const idealLeapRatio = 0.4;
    const deviation = leapRatio - idealLeapRatio;

    // leapBias < 1 discourages leaps; > 1 encourages them
    const leapBias = clamp(1 - deviation * 0.6, 0.7, 1.4);
    // stepBias mirrors: if too many leaps, encourage steps
    const stepBias = clamp(1 + deviation * 0.5, 0.7, 1.3);

    // Density bias: very leap-heavy passages → slight density reduction (give room)
    const densityBias = clamp(1 - m.abs(deviation) * 0.2, 0.9, 1.1);

    return { leapRatio, stepRatio, densityBias, leapBias, stepBias };
  }

  /**
   * Get corrective density multiplier for targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getBalanceSignal().densityBias;
  }

  /**
   * Get interval selection biases for composers (consumed via ConductorState).
   * @returns {{ leapBias: number, stepBias: number }}
   */
  function getIntervalCorrection() {
    const sig = getBalanceSignal();
    return { leapBias: sig.leapBias, stepBias: sig.stepBias };
  }

  return {
    getBalanceSignal,
    getDensityBias,
    getIntervalCorrection
  };
})();
