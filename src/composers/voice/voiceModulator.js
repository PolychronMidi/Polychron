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
   * Texture-aware shaping (#4): chord bursts accent inner voices for fat stabs;
   * flurries apply decrescendo cascade for natural scalar taper.
   * @param {number[]} selectedNotes - MIDI note numbers
   * @param {{ baseVelocity?: number, spread?: number, textureMode?: string }} options
   * @returns {{ note: number, channel: number, velocity: number }[]}
   */
  function distribute(selectedNotes, options = {}) {
    if (!Array.isArray(selectedNotes)) throw new Error('voiceModulator.distribute: selectedNotes array required');
    const base = Number.isFinite(Number(options && options.baseVelocity)) ? Number(options.baseVelocity) : 90;
    // Voice spread params from ConductorConfig (profile-driven)
    const vsCfg = (ConductorConfig && typeof ConductorConfig.getVoiceSpreadScaling === 'function')
      ? ConductorConfig.getVoiceSpreadScaling()
      : { spread: 0.15, chordBurstInnerBoost: 1.0, flurryDecayRate: 1.8, jitterAmount: 0.1 };
    const spread = Number.isFinite(Number(options && options.spread)) ? Number(options.spread) : vsCfg.spread;
    const texMode = (options && typeof options.textureMode === 'string') ? options.textureMode : 'single';
    const count = selectedNotes.length;
    if (count === 0) return [];

    return selectedNotes.map((n, i) => {
      // Voice-position shaping: top voice slightly louder, inner voices softer
      let positionScale;
      if (texMode === 'chordBurst') {
        // Chord burst (#4): accent inner voices for a fat stab, outer voices stay strong
        if (count === 1) {
          positionScale = 1 + spread * 0.4 * vsCfg.chordBurstInnerBoost;
        } else if (i === 0) {
          positionScale = 1 + spread * 0.3 * vsCfg.chordBurstInnerBoost;        // melody still present
        } else if (i === count - 1) {
          positionScale = 1 + spread * 0.35 * vsCfg.chordBurstInnerBoost;       // bass anchor
        } else {
          positionScale = 1 + spread * (0.25 + 0.15 * (i / count)) * vsCfg.chordBurstInnerBoost; // inner voices boosted (inverted)
        }
      } else if (texMode === 'flurry') {
        // Flurry (#4): decrescendo cascade — each successive note slightly softer
        positionScale = 1 - (i / m.max(1, count)) * spread * vsCfg.flurryDecayRate;
      } else {
        // Default: melody accent, inner recede
        if (count === 1) {
          positionScale = 1;
        } else if (i === 0) {
          positionScale = 1 + spread * 0.5;         // melody accent
        } else if (i === count - 1) {
          positionScale = 1 + spread * 0.25;        // bass presence
        } else {
          positionScale = 1 - spread * (0.2 + 0.1 * (i / count)); // inner voices recede
        }
      }
      // Random humanization jitter (±half of jitterAmount)
      const jitter = 1 + (rf() - 0.5) * vsCfg.jitterAmount;
      const vel = m.max(1, m.min(MIDI_MAX_VALUE, m.round(base * positionScale * jitter)));
      return { note: n, channel: i, velocity: vel };
    });
  }

  return { distribute };
})();
