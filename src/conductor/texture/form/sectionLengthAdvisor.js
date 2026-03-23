// src/conductor/sectionLengthAdvisor.js - Advises section/phrase count based on energy trajectory.
// Tracks composite intensity over time to recommend extending or truncating sections.
// Pure query API - consumed by main.js when determining phrasesPerSection.

sectionLengthAdvisor = (() => {
  const V = validator.create('sectionLengthAdvisor');
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
    let effectiveBaseCount = baseCount;
    const shortFormPressure = V.optionalFinite(totalSections, 0) > 0 && totalSections <= 4 ? 1 : 0;
    if (shortFormPressure > 0 && effectiveBaseCount < 2) {
      effectiveBaseCount = 2;
    }
    if (energyHistory.length < 4) return effectiveBaseCount;

    const recent = energyHistory.slice(-4);
    const trend = (recent[3] - recent[0]) / 3;
    const currentEnergy = recent[3];

    // Building energy - extend (up to +2)
    if (trend > 0.05 && currentEnergy > 0.36) {
      return m.min(effectiveBaseCount + m.round(trend * 15) + shortFormPressure, effectiveBaseCount + 2);
    }

    // High sustained energy - keep extended
    if ((currentEnergy > 0.75 && trend > -0.02) || (shortFormPressure > 0 && currentEnergy > 0.55 && trend > -0.04)) {
      return m.min(effectiveBaseCount + 1, effectiveBaseCount + 2);
    }

    // Low and declining energy - truncate (at least 2 phrases)
    if (trend < -0.06 && currentEnergy < 0.3) {
      return m.max(effectiveBaseCount - 1, 2);
    }

    return effectiveBaseCount;
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

  conductorIntelligence.registerRecorder('sectionLengthAdvisor', (ctx) => { sectionLengthAdvisor.recordEnergy(ctx.compositeIntensity); });
  conductorIntelligence.registerModule('sectionLengthAdvisor', { reset }, ['all']);

  return {
    recordEnergy,
    advisePhraseCount,
    getEnergyTrajectory,
    reset
  };
})();
