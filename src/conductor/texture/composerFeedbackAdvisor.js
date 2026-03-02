// composerFeedbackAdvisor.js - Closes the loop between musical quality observation and
// composer selection. Reads existing quality signals (repetition fatigue, textural memory,
// thematic recall, profile adaptation) and produces per-family weight adjustments that
// factoryFamilies.scoreFamilyCandidateConfig can consume. This makes the composer subsystem
// self-aware: it responds to what the organism has recently produced, not just what the
// conductor intends.
//
// Design: pure query API. No side-effects. Registered as a conductorIntelligence
// stateProvider so the advisory is visible in system-manifest.json diagnostics.

composerFeedbackAdvisor = (() => {
  const V = validator.create('composerFeedbackAdvisor');

  /**
   * @typedef {{
   *   fatigueSignal: number,
   *   varietyPressure: number,
   *   thematicStatus: string,
   *   profileHints: { restrainedHint: number, explosiveHint: number, atmosphericHint: number }
   * }} ComposerQualitySnapshot
   */

  /**
   * Collect a point-in-time snapshot of all musical quality signals relevant
   * to composer selection. Each signal is read from its authoritative source.
   * @returns {ComposerQualitySnapshot}
   */
  function _collectSignals() {
    // Repetition fatigue: how stale is the recent melodic content?
    const fatigueProfile = repetitionFatigueMonitor.getRepetitionProfile();
    const fatigueSignal = fatigueProfile.fatigueLevel;

    // Textural variety pressure: how concentrated has family usage been?
    // structuralNarrativeAdvisor tracks family history and exposes varietyPressure.
    const varietyPressure = structuralNarrativeAdvisor.getVarietyPressure();

    // Thematic recall: is the current material echoing an earlier section?
    const thematic = thematicRecallDetector.getThematicSignal();

    // Profile adaptation hints: sustained conditions suggesting character shift
    const profileHints = profileAdaptation.getHints();

    return {
      fatigueSignal,
      varietyPressure,
      thematicStatus: thematic.thematicStatus,
      profileHints
    };
  }

  /**
   * Compute per-family weight multipliers for composer selection.
   * Incorporates quality signals to bias away from overused patterns
   * and toward families that would address current musical needs.
   *
   * @param {string[]} availableFamilies - family names from COMPOSER_FAMILIES
   * @returns {Record<string, number>} family name - weight multiplier (0.3 to 2.0)
   */
  function getFamilyWeightAdjustments(availableFamilies) {
    V.assertArray(availableFamilies, 'availableFamilies');
    if (availableFamilies.length === 0) return {};

    const signals = _collectSignals();
    /** @type {Record<string, number>} */
    const weights = {};

    // Textural memory: bias toward underused families, penalize overused
    const memoryWeights = texturalMemoryAdvisor.getBiasWeights(availableFamilies);

    // Recall suggestion: if a previously-used family could create thematic callback
    const recallSuggestion = texturalMemoryAdvisor.suggestRecall(
      V.optionalFinite(sectionIndex, 0),
      availableFamilies
    );

    for (let i = 0; i < availableFamilies.length; i++) {
      const family = availableFamilies[i];
      let w = 1.0;

      // Layer 1: Textural memory diversity pressure
      const memW = memoryWeights[family];
      if (typeof memW === 'number' && Number.isFinite(memW)) {
        w *= memW;
      }

      // Layer 2: Fatigue response - when melodic content is stale, boost families
      // that tend toward different voicing strategies (non-default families get a lift)
      if (signals.fatigueSignal > 0.3) {
        const fatigueBoost = signals.fatigueSignal * 0.4;
        // Default/standard family gets penalized; others get boosted
        if (family === 'default' || family === 'standard') {
          w *= clamp(1.0 - fatigueBoost, 0.5, 1.0);
        } else {
          w *= clamp(1.0 + fatigueBoost * 0.5, 1.0, 1.5);
        }
      }

      // Layer 3: Variety pressure from structural narrative - when the system
      // has been using the same families repeatedly, amplify less-used options
      if (signals.varietyPressure > 0.3) {
        const varietyScale = signals.varietyPressure * 0.3;
        // Memory weights already encode over/underuse, so amplify that signal
        if (typeof memW === 'number' && memW > 1.0) {
          w *= clamp(1.0 + varietyScale, 1.0, 1.4);
        } else if (typeof memW === 'number' && memW < 1.0) {
          w *= clamp(1.0 - varietyScale * 0.5, 0.6, 1.0);
        }
      }

      // Layer 4: Thematic recall - if we're hearing echoes of earlier material,
      // and a specific family could serve as a thematic callback, boost it
      if (signals.thematicStatus === 'echo' || signals.thematicStatus === 'strong-recall') {
        if (recallSuggestion === family) {
          w *= 1.4;
        }
      }

      // Layer 5: Profile adaptation hints - match family character to musical needs
      // Restrained hint - boost families with calmer character
      // Explosive hint - boost families with intense character
      if (signals.profileHints.restrainedHint > 0.3) {
        // Families containing 'harmonic' or 'modal' tend to be calmer
        if (family.includes('harmonic') || family.includes('modal') || family.includes('tonal')) {
          w *= clamp(1.0 + signals.profileHints.restrainedHint * 0.3, 1.0, 1.3);
        }
      }
      if (signals.profileHints.explosiveHint > 0.3) {
        // Families containing 'chromatic' or 'tension' tend to be more intense
        if (family.includes('chromatic') || family.includes('tension') || family.includes('rhythmic')) {
          w *= clamp(1.0 + signals.profileHints.explosiveHint * 0.3, 1.0, 1.3);
        }
      }

      weights[family] = clamp(w, 0.3, 2.0);
    }

    return weights;
  }

  /**
   * Score adjustment for an individual composer candidate config.
   * Called from factoryFamilies.scoreFamilyCandidateConfig to layer quality
   * feedback onto the existing previous/peer scoring logic.
   *
   * @param {{ type: string }} candidateConfig
   * @returns {number} multiplier (0.5 to 1.5) applied to the base score
   */
  function scoreCandidateAdjustment(candidateConfig) {
    V.assertPlainObject(candidateConfig, 'candidateConfig');
    const type = candidateConfig.type;
    if (!V.optionalType(type, 'string') || (type && type.length === 0)) return 1.0;

    const signals = _collectSignals();
    let adjustment = 1.0;

    // If fatigued, penalize the same type we've been using heavily
    if (signals.fatigueSignal > 0.4) {
      // structuralNarrativeAdvisor.getHistory() tracks recent family picks
      const history = structuralNarrativeAdvisor.getHistory();
      if (history.length >= 2) {
        const recent = history[history.length - 1];
        const secondRecent = history[history.length - 2];
        // If the last 2 phrases used the same family, and this candidate
        // matches that family's typical type, apply a novelty penalty
        if (recent === secondRecent) {
          adjustment *= clamp(1.0 - signals.fatigueSignal * 0.25, 0.6, 1.0);
        }
      }
    }

    // If variety pressure is high, boost compositional diversity
    if (signals.varietyPressure > 0.5) {
      adjustment *= clamp(1.0 + (signals.varietyPressure - 0.5) * 0.3, 1.0, 1.3);
    }

    return clamp(adjustment, 0.5, 1.5);
  }

  /**
   * Get the full quality snapshot for diagnostics / conductorState.
   * @returns {ComposerQualitySnapshot}
   */
  function getQualitySnapshot() {
    return _collectSignals();
  }

  /** No-op reset - stateless query module. Kept explicit per project convention. */
  function reset() {
    // Stateless - reads from authoritative sources each call.
  }

  // Self-register: state provider exposes quality signals in system-manifest
  conductorIntelligence.registerStateProvider('composerFeedbackAdvisor', () => {
    const snap = _collectSignals();
    return {
      composerFatigueSignal: snap.fatigueSignal,
      composerVarietyPressure: snap.varietyPressure,
      composerThematicStatus: snap.thematicStatus
    };
  });
  conductorIntelligence.registerModule('composerFeedbackAdvisor', { reset }, ['section']);

  return {
    getFamilyWeightAdjustments,
    scoreCandidateAdjustment,
    getQualitySnapshot,
    reset
  };
})();
