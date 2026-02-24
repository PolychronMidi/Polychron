// src/conductor/OctaveSpreadMonitor.js - Note distribution across octaves.
// Detects octave clustering (all notes in one octave) vs wide spread.
// Pure query API â€” nudges composers toward underused octaves via ConductorState.

OctaveSpreadMonitor = (() => {
  const V = Validator.create('octaveSpreadMonitor');
  const WINDOW_SECONDS = 4;

  /**
   * Analyze octave distribution of recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ octaveCounts: Array<number>, usedOctaves: number, spread: number, clustered: boolean, wide: boolean }}
   */
  function getOctaveProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);

    // Use shared helper â€” default 11 bands matches our 0-10 octave range
    const { counts: octaveCounts, total } = octaveHelpers.getOctaveHistogram(ws, 11, layer);

    if (total < 3) {
      return { octaveCounts, usedOctaves: 0, spread: 0, clustered: false, wide: false };
    }

    let usedOctaves = 0;
    let minOctave = 10;
    let maxOctave = 0;
    for (let i = 0; i < 11; i++) {
      if (octaveCounts[i] > 0) {
        usedOctaves++;
        if (i < minOctave) minOctave = i;
        if (i > maxOctave) maxOctave = i;
      }
    }

    const spread = maxOctave - minOctave;

    return {
      octaveCounts,
      usedOctaves,
      spread,
      clustered: usedOctaves <= 1,
      wide: spread >= 4
    };
  }

  /**
   * Get underused octaves in the typical piano range (2-7).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {Array<number>} - octave numbers that are underrepresented
   */
  function getUnderusedOctaves(opts) {
    const profile = getOctaveProfile(opts);
    const total = profile.octaveCounts.reduce((a, b) => a + b, 0);
    if (total < 4) return [];

    const underused = [];
    // Only consider octaves 2-7 (musically useful range)
    for (let oct = 2; oct <= 7; oct++) {
      if (profile.octaveCounts[oct] < total * 0.05) {
        underused.push(oct);
      }
    }
    return underused;
  }

  /**
   * Get a register spread bias.
   * Clustered â†’ encourage wider spread; already wide â†’ no adjustment.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - bias in semitones to nudge register (-6 to +6)
   */
  function getSpreadBias(opts) {
    const profile = getOctaveProfile(opts);
    if (profile.clustered) return 6;   // Push outward
    if (profile.wide) return 0;        // Already diverse
    if (profile.spread < 2) return 3;  // Gently widen
    return 0;
  }

  ConductorIntelligence.registerStateProvider('OctaveSpreadMonitor', () => ({
    octaveSpreadBias: OctaveSpreadMonitor.getSpreadBias()
  }));

  return {
    getOctaveProfile,
    getUnderusedOctaves,
    getSpreadBias
  };
})();

