// src/conductor/StructuralFormTracker.js - Section-level form map.
// Tracks which families, keys, energy levels appeared in each section.
// Detects ABA returns, through-composed drift, or lack of recapitulation.
// Pure query API — advises family/key selection for structural callbacks.

StructuralFormTracker = (() => {
  const V = Validator.create('StructuralFormTracker');
  /** @type {Array<{ section: number, family: string, key: string, mode: string, energy: number }>} */
  const formMap = [];

  /**
   * Record the musical state of a section after it completes.
   * @param {number} section - section index
   * @param {string} family - primary composer family used
   * @param {string} key - harmonic key
   * @param {string} mode - harmonic mode
   * @param {number} energy - average composite intensity (0-1)
   */
  function recordSection(section, family, key, mode, energy) {
    V.requireFinite(section, 'section');
    formMap.push({ section, family, key, mode, energy });
  }

  /**
   * Detect whether the piece has recurring material (ABA-like).
   * Returns the index of the opening section if a return would be appropriate.
   * @param {number} currentSection
   * @param {number} totalSections
   * @returns {{ shouldRecap: boolean, recapSection: number|null, recapFamily: string|null, recapKey: string|null }}
   */
  function checkRecapitulation(currentSection, totalSections) {
    if (formMap.length === 0 || currentSection < 2 || totalSections < 3) {
      return { shouldRecap: false, recapSection: null, recapFamily: null, recapKey: null };
    }

    // Suggest recap in the final ~25% of sections
    const progressRatio = TimeStream.normalizedProgress('section');
    if (progressRatio < 0.75) {
      return { shouldRecap: false, recapSection: null, recapFamily: null, recapKey: null };
    }

    // Return to opening material
    const opening = formMap[0];
    if (!opening) {
      return { shouldRecap: false, recapSection: null, recapFamily: null, recapKey: null };
    }

    // Check if we already recapped recently
    const recent = formMap[formMap.length - 1];
    if (recent && recent.family === opening.family && recent.key === opening.key) {
      return { shouldRecap: false, recapSection: null, recapFamily: null, recapKey: null };
    }

    return {
      shouldRecap: true,
      recapSection: 0,
      recapFamily: opening.family,
      recapKey: opening.key
    };
  }

  /**
   * Get the energy trajectory across all recorded sections.
   * @returns {{ values: Array<number>, trend: string }}
   */
  function getEnergyArc() {
    const values = formMap.map(s => s.energy);
    if (values.length < 2) return { values, trend: 'insufficient' };

    const { slope } = analysisHelpers.halfSplitSlope(values);

    let trend = 'flat';
    if (slope > 0.1) trend = 'building';
    else if (slope < -0.1) trend = 'winding-down';

    return { values, trend };
  }

  /**
   * Get which families have been used and how often.
   * @returns {Object.<string, number>}
   */
  function getFamilyUsage() {
    const counts = /** @type {Object.<string, number>} */ ({});
    for (let i = 0; i < formMap.length; i++) {
      const f = formMap[i].family;
      counts[f] = (counts[f] || 0) + 1;
    }
    return counts;
  }

  /** Reset tracking. */
  function reset() {
    formMap.length = 0;
  }

  return {
    recordSection,
    checkRecapitulation,
    getEnergyArc,
    getFamilyUsage,
    reset
  };
})();
ConductorIntelligence.registerStateProvider('StructuralFormTracker', () => ({
  sectionCount: Object.keys(StructuralFormTracker.getFamilyUsage()).length,
  energyTrend: StructuralFormTracker.getEnergyArc().trend
}));
ConductorIntelligence.registerModule('StructuralFormTracker', { reset: StructuralFormTracker.reset }, ['section']);
