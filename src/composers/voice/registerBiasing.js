// registerBiasing.js - register bias selection and filtering helper

/**
 * Applies register bias (higher/lower) using phrase arc context and intent.
 * Returns filtered note pool and resolved bias choice.
 */
registerBiasing = {
  _V: validator.create('registerBiasing'),
  /**
   * Apply register bias filtering to a note pool
   * @param {number[]} notePool - Candidate notes
   * @param {number} maxVoices - Max voices to select
   * @param {Object} opts - Options containing registerBias override
   * @param {Object} phraseContext - Phrase arc context
   * @returns {{notePool: number[], finalRegisterBias: string|undefined}}
   */
  apply(notePool, maxVoices, opts = {}, phraseContext = {}) {
    let finalRegisterBias = opts.registerBias; // 'higher'|'lower'|undefined
    const arcRegisterBias = registerBiasing._V.optionalFinite(phraseContext.registerBias, 0);

    // Arc-based bias: apply probabilistically to preserve variety
    if (!finalRegisterBias && m.abs(arcRegisterBias) > VOICE_Manager.arcRegisterBiasThreshold && rf() < VOICE_Manager.arcRegisterBiasChance) {
      finalRegisterBias = arcRegisterBias > 0 ? 'higher' : 'lower';
    }

    let filteredPool = notePool;

    // Register filtering based on final bias (from intent or arc)
    // But only if it won't result in an empty pool
    if (finalRegisterBias === 'higher' && notePool.length > maxVoices * 1.5) {
      // Sort pool by pitch and favor upper portion
      const sorted = [...notePool].sort((a, b) => b - a); // Descending
      const upperBias = m.ceil(sorted.length * 0.7); // Top 70% (less aggressive)
      const filtered = sorted.slice(0, upperBias);
      // Only apply if filter result is non-empty and substantial
      if (filtered.length >= maxVoices) {
        filteredPool = filtered;
      }
    } else if (finalRegisterBias === 'lower' && notePool.length > maxVoices * 1.5) {
      const sorted = [...notePool].sort((a, b) => a - b); // Ascending
      const lowerBias = m.ceil(sorted.length * 0.7); // Bottom 70% (less aggressive)
      const filtered = sorted.slice(0, lowerBias);
      // Only apply if filter result is non-empty and substantial
      if (filtered.length >= maxVoices) {
        filteredPool = filtered;
      }
    }

    return { notePool: filteredPool, finalRegisterBias };
  }
};
