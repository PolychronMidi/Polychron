

/**
 * Structural Narrative Advisor - Compositional Strategy Memory (E3)
 *
 * Tracks which composer families and texture profiles have been used
 * across sections. Provides a "variety pressure" density bias that
 * encourages the system to explore under-represented strategies.
 * Also exposes state to conductorState for downstream consumers.
 */

structuralNarrativeAdvisor = (() => {

  const VARIETY_GAIN = 0.08;
  const MAX_HISTORY  = 32;

  /** @type {string[]} */
  let familyHistory  = [];
  /** @type {Map<string, number>} */
  let familyCounts   = new Map();
  let varietyPressure = 1.0;

  function recordFamily(family) {
    if (typeof family !== 'string' || family.length === 0) {
      throw new Error('structuralNarrativeAdvisor: family must be a non-empty string');
    }
    familyHistory.push(family);
    if (familyHistory.length > MAX_HISTORY) familyHistory.shift();
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
    structuralNarrativeAdvisorRecompute();
  }

  function structuralNarrativeAdvisorRecompute() {
    if (familyHistory.length < 2) {
      varietyPressure = 1.0;
    } else {
      const unique = familyCounts.size;
      const total  = familyHistory.length;
      const entropy = unique / m.max(total, 1);

      // Low entropy - push density up slightly to encourage change
      varietyPressure = 1.0 + VARIETY_GAIN * (1.0 - entropy);
    }
  }

  /**
   * Called each beat via recorder - reads current composer from state.
   */
  function refresh() {
    const snap = conductorState.getSnapshot();
    const family = snap.textureMode || snap.activeProfile || null;
    if (family) recordFamily(String(family));
  }

  function densityBias() { return varietyPressure; }

  function getHistory() { return [...familyHistory]; }

  function getVarietyPressure() { return varietyPressure; }

  function reset() {
    familyHistory   = [];
    familyCounts    = new Map();
    varietyPressure = 1.0;
  }

  // Self-registration
  conductorIntelligence.registerDensityBias('structuralNarrativeAdvisor', densityBias, 0.96, 1.12);
  conductorIntelligence.registerRecorder('structuralNarrativeAdvisor', refresh);
  conductorIntelligence.registerStateProvider('structuralNarrativeAdvisor', () => ({
    composerVariety: varietyPressure,
    uniqueFamilies: familyCounts.size,
  }));
  conductorIntelligence.registerModule('structuralNarrativeAdvisor', { reset }, ['all']);

  return { recordFamily, getHistory, getVarietyPressure, densityBias, reset };
})();
