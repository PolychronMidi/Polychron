// src/utils/modeQualityMap.js — Canonical mode-to-quality mapping.
// Shared by all priors modules (melodic, harmonic, voiceLeading, rhythm).

modeQualityMap = (() => {
  /** @type {Readonly<Record<string, string>>} */
  const map = Object.freeze({
    ionian: 'major', dorian: 'dorian', phrygian: 'minor', lydian: 'major',
    mixolydian: 'mixolydian', aeolian: 'minor', locrian: 'minor', major: 'major', minor: 'minor'
  });

  /**
   * Normalize a quality or mode string to a canonical quality key.
   * Returns null for unrecognised input — callers decide how to handle failure.
   * @param {string} input
   * @returns {string | null}
   */
  function normalizeOrNull(input) {
    if (typeof input !== 'string' || input.length === 0) return null;
    const normalized = input.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(map, normalized)) return map[normalized];
    if (normalized.includes('min')) return 'minor';
    if (normalized.includes('maj')) return 'major';
    return null;
  }

  /**
   * Normalize a quality or mode string — throws on unrecognised input.
   * @param {string} input
   * @param {string} label — call-site label for the error message
   * @returns {string}
   */
  function normalizeOrFail(input, label) {
    const result = normalizeOrNull(input);
    if (result === null) {
      throw new Error(`${label}: unknown quality or mode "${input}"`);
    }
    return result;
  }

  return { map, normalizeOrNull, normalizeOrFail };
})();
