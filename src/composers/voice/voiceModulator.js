// voiceModulator.js - adapter to map voice assignments to channel/note structures
// Produces per-voice velocity distributions with organic humanization so that
// each voice in a chord has a slightly different intensity, creating a natural
// ensemble feel rather than flat machine-gun velocity.

voiceModulator = (function() {
  /**
   * Distribute velocity across voices with humanized variation.
   * The first voice (melody) gets a slight accent; inner voices are softer;
   * outer voices are slightly louder. Small random jitter ensures no two
   * calls produce identical distributions.
   * @param {number[]} selectedNotes - MIDI note numbers
   * @param {{ baseVelocity?: number, spread?: number }} options
   * @returns {{ note: number, channel: number, velocity: number }[]}
   */
  function distribute(selectedNotes, options = {}) {
    if (!Array.isArray(selectedNotes)) throw new Error('voiceModulator.distribute: selectedNotes array required');
    const base = Number.isFinite(Number(options && options.baseVelocity)) ? Number(options.baseVelocity) : 90;
    const spread = Number.isFinite(Number(options && options.spread)) ? Number(options.spread) : 0.15;
    const count = selectedNotes.length;
    if (count === 0) return [];

    return selectedNotes.map((n, i) => {
      // Voice-position shaping: top voice slightly louder, inner voices softer
      let positionScale;
      if (count === 1) {
        positionScale = 1;
      } else if (i === 0) {
        positionScale = 1 + spread * 0.5;         // melody accent
      } else if (i === count - 1) {
        positionScale = 1 + spread * 0.25;        // bass presence
      } else {
        positionScale = 1 - spread * (0.2 + 0.1 * (i / count)); // inner voices recede
      }
      // Random humanization jitter (±5% of base)
      const jitter = 1 + (rf() - 0.5) * 0.1;
      const vel = m.max(1, m.min(127, m.round(base * positionScale * jitter)));
      return { note: n, channel: i, velocity: vel };
    });
  }

  return { distribute };
})();
