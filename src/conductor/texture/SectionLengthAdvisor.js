// src/conductor/SectionLengthAdvisor.js - Advises section/phrase count based on energy trajectory.
// Tracks composite intensity over time to recommend extending or truncating sections.
// Pure query API — consumed by main.js when determining phrasesPerSection.

SectionLengthAdvisor = (() => {
  const V = Validator.create('SectionLengthAdvisor');
  /** @type {Array<number>} */
  const energyHistory = [];
  const MAX_HISTORY = 60;

  /**
   * Record a composite intensity sample (typically once per beat or phrase).
   * @param {number} compositeIntensity - 0 to 1
   */
  function recordEnergy(compositeIntensity) {
    V.requireFinite(compositeIntensity, 'compositeIntensity');
    energyHistory.push(clamp(compositeIntensity, 0, 1));
    if (energyHistory.length > MAX_HISTORY) energyHistory.shift();
  }

  /**
   * Advise a phrase count adjustment based on energy trajectory.
   * Extending when energy is building, truncating when stagnating.
   * @param {number} baseCount - raw phrase count from ri(min, max)
   * @returns {number} - adjusted phrase count (always >= 2)
   */
  function advisePhraseCount(baseCount) {
    if (energyHistory.length < 4) return baseCount;

    const recent = energyHistory.slice(-4);
    const trend = (recent[3] - recent[0]) / 3;
    const currentEnergy = recent[3];

    // Building energy → extend (up to +2)
    if (trend > 0.06 && currentEnergy > 0.4) {
      return m.min(baseCount + m.round(trend * 15), baseCount + 2);
    }

    // High sustained energy → keep extended
    if (currentEnergy > 0.75 && trend > -0.02) {
      return m.min(baseCount + 1, baseCount + 2);
    }

    // Low and declining energy → truncate (at least 2 phrases)
    if (trend < -0.06 && currentEnergy < 0.3) {
      return m.max(baseCount - 1, 2);
    }

    return baseCount;
  }

  /**
   * Get the current energy trend direction.
   * @returns {{ trend: number, currentEnergy: number, samples: number }}
   */
  function getEnergyTrajectory() {
    if (energyHistory.length < 2) {
      return { trend: 0, currentEnergy: 0, samples: energyHistory.length };
    }
    const recent = energyHistory.slice(-4);
    const trend = recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / m.max(1, recent.length - 1) : 0;
    return {
      trend,
      currentEnergy: energyHistory[energyHistory.length - 1],
      samples: energyHistory.length
    };
  }

  /** Reset state. */
  function reset() {
    energyHistory.length = 0;
  }

  ConductorIntelligence.registerRecorder('SectionLengthAdvisor', (ctx) => { SectionLengthAdvisor.recordEnergy(ctx.compositeIntensity); });
  ConductorIntelligence.registerModule('SectionLengthAdvisor', { reset }, ['section']);

  return {
    recordEnergy,
    advisePhraseCount,
    getEnergyTrajectory,
    reset
  };
})();
