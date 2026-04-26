// stutterSteps.js - per-step gating logic for stutter note emission.
// Two gating layers: pattern-based (structured rhythm) and probabilistic
// (sustain-proportional + variant selfGate). Both must pass for a step to emit.
// Extracted from stutterNotes for single-responsibility and reuse by variants.

moduleLifecycle.declare({
  name: 'stutterSteps',
  subsystem: 'fx',
  deps: [],
  provides: ['stutterSteps'],
  init: () => {

  /**
   * Evaluate whether this stutter step should emit.
   * @param {number} sustain - sustain of the stutter note in seconds
   * @returns {boolean} true if step should emit
   */
  function shouldEmit(sustain) {
    // Layer 1: pattern gate (structured rhythm from patterns.js)
    if (!stutterVariants.patternGate()) return false;

    // Layer 2: probabilistic gate (sustain-proportional + variant selfGate)
    const selfGate = stutterVariants.getActiveSelfGate();
    const stepGate = clamp(sustain / m.max(0.01, spBeat), 0.15, 1) * selfGate;
    return rf() < stepGate;
  }

  /**
   * Compute the sustain-proportional gate probability without rolling dice.
   * Useful for diagnostics and variant logic that needs to know the probability
   * without actually gating.
   * @param {number} sustain
   * @returns {number} probability 0-1
   */
  function getStepProbability(sustain) {
    const selfGate = stutterVariants.getActiveSelfGate();
    return clamp(sustain / m.max(0.01, spBeat), 0.15, 1) * selfGate;
  }

  /**
   * Check only the pattern gate without the probabilistic layer.
   * @returns {boolean}
   */
  function patternAllows() {
    return stutterVariants.patternGate();
  }

  return { shouldEmit, getStepProbability, patternAllows };
  },
});
