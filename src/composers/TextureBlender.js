// TextureBlender.js — Per-unit texture mode selector for contrast-blend oscillations.
// Decides whether a unit should emit normally ('single'), fire a percussive
// chord stab ('chordBurst'), or inject a rapid scalar flurry ('flurry').
// Probabilities oscillate using micro-hyper technique so texture switching
// never settles into a predictable pattern.

TextureBlender = (() => {
  /**
   * Resolve the texture mode for a given unit invocation.
   * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
   * @param {number} composite - DynamismEngine composite intensity (0-1)
   * @returns {{ mode: 'single'|'chordBurst'|'flurry', velocityScale: number, sustainScale: number }}
   */
  function resolve(unit, composite) {
    if (typeof unit !== 'string' || unit.length === 0) {
      throw new Error('TextureBlender.resolve: unit must be a non-empty string');
    }
    if (!Number.isFinite(composite)) {
      throw new Error('TextureBlender.resolve: composite must be a finite number');
    }

    // ── Oscillating probability seeds ──────────────────────────────
    // Use unitStart (tick position) to create non-repeating oscillation
    const seed = (typeof unitStart === 'number' && Number.isFinite(unitStart))
      ? unitStart
      : (typeof beatStart === 'number' && Number.isFinite(beatStart) ? beatStart : 0);
    const unitDepth = unit === 'beat' ? 0 : unit === 'div' ? 1 : unit === 'subdiv' ? 2 : 3;

    // Two incommensurate oscillations for chaotic probability modulation
    const oscA = (m.sin(seed * 0.0023 + unitDepth * 3.7) + 1) * 0.5; // 0-1
    const oscB = (m.sin(seed * 0.0059 - unitDepth * 5.3) + 1) * 0.5; // 0-1
    const oscBlend = oscA * 0.6 + oscB * 0.4;

    // Scale flicker with crossModulation for self-reinforcing texture feedback
    const crossModFactor = (typeof crossModulation === 'number' && Number.isFinite(crossModulation))
      ? clamp(crossModulation / 6, 0, 1)
      : 0.5;

    // ── Chord burst probability ────────────────────────────────────
    // Higher when composite is high (shredding territory) — stabs interrupting runs
    // Deeper units get higher chord burst chance for dramatic contrast
    const burstBase = unit === 'beat' ? 0.02 : unit === 'div' ? 0.06 : unit === 'subdiv' ? 0.10 : 0.08;
    const burstProb = clamp(
      burstBase * (0.3 + composite * 1.5) * (0.6 + oscBlend * 0.8) * (0.7 + crossModFactor * 0.6),
      0,
      0.18 // cap to avoid overwhelming
    );

    // ── Flurry probability ─────────────────────────────────────────
    // Higher when composite is low (pad territory) — runs interrupting chords
    // Also possible at moderate intensity for contrast
    const flurryBase = unit === 'beat' ? 0.03 : unit === 'div' ? 0.08 : unit === 'subdiv' ? 0.06 : 0.04;
    const invertedComposite = 1 - composite;
    const flurryProb = clamp(
      flurryBase * (0.3 + invertedComposite * 1.5) * (0.5 + (1 - oscBlend) * 1.0) * (0.7 + crossModFactor * 0.6),
      0,
      0.15
    );

    // ── Roll the dice ──────────────────────────────────────────────
    const roll = rf();
    if (roll < burstProb) {
      return {
        mode: 'chordBurst',
        velocityScale: clamp(0.75 + composite * 0.3 + rf(-0.05, 0.05), 0.5, 1.2),
        sustainScale: clamp(0.15 + (1 - composite) * 0.25, 0.1, 0.5) // short stab
      };
    }
    if (roll < burstProb + flurryProb) {
      return {
        mode: 'flurry',
        velocityScale: clamp(0.65 + invertedComposite * 0.25 + rf(-0.05, 0.05), 0.4, 1.0),
        sustainScale: clamp(0.1 + composite * 0.15, 0.08, 0.3) // rapid notes
      };
    }

    return { mode: 'single', velocityScale: 1, sustainScale: 1 };
  }

  return { resolve };
})();
