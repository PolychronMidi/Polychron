// src/conductor/TexturalMemoryAdvisor.js - Tracks which composer/texture modes have been used.
// Detects overuse or neglect of certain timbral colors across sections.
// Pure query API — biases ComposerFactory selection toward underused textures.

TexturalMemoryAdvisor = (() => {
  /** @type {Object.<string, { count: number, lastSection: number }>} */
  const usage = {};
  let totalSelections = 0;

  /**
   * Record that a composer/family was selected.
   * @param {string} composerName - composer or family identifier
   * @param {number} section - current section index
   */
  function recordUsage(composerName, section) {
    if (typeof composerName !== 'string' || composerName.length === 0) {
      throw new Error('TexturalMemoryAdvisor.recordUsage: composerName must be a non-empty string');
    }
    if (!usage[composerName]) {
      usage[composerName] = { count: 0, lastSection: -1 };
    }
    const entry = usage[composerName];
    if (entry) {
      entry.count++;
      entry.lastSection = section;
    }
    totalSelections++;
  }

  /**
   * Get overuse/underuse bias weights for available composers.
   * Underused composers get a boost; overused get a penalty.
   * @param {Array<string>} available - list of available composer names
   * @returns {Object.<string, number>} - name → weight multiplier (0.5 to 2.0)
   */
  function getBiasWeights(available) {
    if (!Array.isArray(available) || available.length === 0 || totalSelections === 0) {
      const out = /** @type {Object.<string, number>} */ ({});
      if (Array.isArray(available)) {
        for (let i = 0; i < available.length; i++) out[available[i]] = 1.0;
      }
      return out;
    }

    const expectedShare = 1 / available.length;
    const weights = /** @type {Object.<string, number>} */ ({});

    for (let i = 0; i < available.length; i++) {
      const name = available[i];
      const entry = usage[name];
      const share = entry ? entry.count / totalSelections : 0;
      const ratio = share / expectedShare;

      // Overused (ratio > 1.5) → penalty; underused (ratio < 0.5) → boost
      if (ratio > 1.5) {
        weights[name] = clamp(0.5 + (2 - ratio) * 0.25, 0.5, 1.0);
      } else if (ratio < 0.5) {
        weights[name] = clamp(1.5 + (0.5 - ratio), 1.5, 2.0);
      } else {
        weights[name] = 1.0;
      }
    }

    return weights;
  }

  /**
   * Suggest a composer to recall for structural cohesion.
   * Returns a previously-used composer from earlier sections.
   * @param {number} currentSection
   * @param {Array<string>} available
   * @returns {string|null}
   */
  function suggestRecall(currentSection, available) {
    if (!Array.isArray(available) || available.length === 0 || totalSelections < 4) return null;

    // Find a composer used in an earlier section (at least 2 sections ago) for callback
    let bestCandidate = null;
    let bestDistance = 0;

    for (let i = 0; i < available.length; i++) {
      const name = available[i];
      const entry = usage[name];
      if (!entry) continue;
      const distance = currentSection - entry.lastSection;
      if (distance >= 2 && distance > bestDistance) {
        bestDistance = distance;
        bestCandidate = name;
      }
    }

    return bestCandidate;
  }

  /** Reset all tracking. */
  function reset() {
    const keys = Object.keys(usage);
    for (let i = 0; i < keys.length; i++) delete usage[keys[i]];
    totalSelections = 0;
  }

  return {
    recordUsage,
    getBiasWeights,
    suggestRecall,
    reset
  };
})();
ConductorIntelligence.registerStateProvider('TexturalMemoryAdvisor', () => ({
  usageKeys: Object.keys(TexturalMemoryAdvisor.getBiasWeights([])).length
}));
