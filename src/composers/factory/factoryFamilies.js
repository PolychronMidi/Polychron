factoryFamilies = {
  getComposerFamiliesOrFail(constructors) {
    if (!constructors || typeof constructors !== 'object') {
      throw new Error('factoryFamilies.getComposerFamiliesOrFail: constructors must be an object');
    }
    const fallback = {
      default: {
        weight: 1,
        types: Object.keys(constructors)
      }
    };
    const source = (COMPOSER_FAMILIES)
      ? COMPOSER_FAMILIES
      : fallback;

    const validTypes = new Set(Object.keys(constructors));
    const normalized = {};
    const familyNames = Object.keys(source);
    if (familyNames.length === 0) {
      throw new Error('ComposerFactory.getComposerFamiliesOrFail: no composer families configured');
    }

    for (const familyName of familyNames) {
      const family = source[familyName];
      if (!family || typeof family !== 'object') {
        throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" must be an object`);
      }
      const types = Array.isArray(family.types) ? family.types : null;
      if (!types || types.length === 0) {
        throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" must define a non-empty types array`);
      }

      const normalizedTypes = [];
      for (const type of types) {
        if (typeof type !== 'string' || type.length === 0) {
          throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" has invalid type entry`);
        }
        if (!validTypes.has(type)) {
          throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" references unknown composer type "${type}"`);
        }
        if (!normalizedTypes.includes(type)) normalizedTypes.push(type);
      }

      const weight = Number(family.weight);
      // Apply conductor profile family weight multiplier if available
      const profileMultiplier = (ConductorConfig && typeof ConductorConfig.getFamilyWeights === 'function')
        ? (Number(ConductorConfig.getFamilyWeights()[familyName]) || 1)
        : 1;
      normalized[familyName] = {
        weight: (Number.isFinite(weight) && weight > 0 ? weight : 1) * profileMultiplier,
        types: normalizedTypes
      };
    }

    return normalized;
  },

  /**
   * Resolve a phrase family name using extraConfig and optional composer context.
   * @param {Object} [extraConfig]
   * @param {Object|null} [composerCtx]
   * @param {Object|null} [sharedComposerCtx]
   * @param {Object} [constructors]
   * @returns {string}
   */
  resolvePhraseFamilyOrFail(extraConfig = {}, composerCtx = null, sharedComposerCtx = null, constructors = {}) {
    if (extraConfig !== undefined && (typeof extraConfig !== 'object' || extraConfig === null)) {
      throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: extraConfig must be an object');
    }
    if (composerCtx !== null && composerCtx !== undefined && (typeof composerCtx !== 'object' || composerCtx === null)) {
      throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: composerCtx must be an object when provided');
    }

    const families = this.getComposerFamiliesOrFail(constructors);
    const context = (composerCtx && typeof composerCtx === 'object')
      ? composerCtx
      : ((sharedComposerCtx && typeof sharedComposerCtx === 'object') ? sharedComposerCtx : null);

    let requestedFamily = extraConfig.phraseFamily ?? extraConfig.composerFamily;
    if ((requestedFamily === undefined || requestedFamily === null) && context && typeof context.phraseFamily === 'string') {
      requestedFamily = context.phraseFamily;
    }

    if ((requestedFamily === undefined || requestedFamily === null) && context && typeof context.selectPhraseFamily === 'function') {
      const selected = context.selectPhraseFamily({
        availableFamilies: Object.keys(families),
        sectionIndex: sectionIndex,
        phraseIndex: phraseIndex,
        measureIndex: measureIndex
      });
      if (selected !== undefined && selected !== null) {
        requestedFamily = selected;
      }
    }

    if (requestedFamily !== undefined && requestedFamily !== null) {
      if (typeof requestedFamily !== 'string' || requestedFamily.length === 0) {
        throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: requested family must be a non-empty string');
      }
      if (!Object.prototype.hasOwnProperty.call(families, requestedFamily)) {
        throw new Error(`ComposerFactory.resolvePhraseFamilyOrFail: unknown family "${requestedFamily}"`);
      }
      return requestedFamily;
    }

    const familyNames = Object.keys(families);
    let totalWeight = 0;
    for (const familyName of familyNames) {
      totalWeight += Number(families[familyName].weight);
    }
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: family weights must sum to a positive finite number');
    }

    let roll = rf() * totalWeight;
    for (const familyName of familyNames) {
      roll -= Number(families[familyName].weight);
      if (roll <= 0) return familyName;
    }
    return familyNames[familyNames.length - 1];
  },

  inferComposerType(composerInstance) {
    if (!composerInstance || typeof composerInstance !== 'object') return null;
    if (typeof composerInstance._factoryType === 'string' && composerInstance._factoryType.length > 0) {
      return composerInstance._factoryType;
    }
    const ctorName = composerInstance.constructor && composerInstance.constructor.name;
    const byCtorName = {
      MeasureComposer: 'measure',
      ScaleComposer: 'scale',
      ChordComposer: 'chords',
      ModeComposer: 'mode',
      PentatonicComposer: 'pentatonic',
      BluesComposer: 'blues',
      ChromaticComposer: 'chromatic',
      QuartalComposer: 'quartal',
      TensionReleaseComposer: 'tensionRelease',
      ModalInterchangeComposer: 'modalInterchange',
      MelodicDevelopmentComposer: 'melodicDevelopment',
      VoiceLeadingComposer: 'voiceLeading',
      HarmonicRhythmComposer: 'harmonicRhythm'
    };
    return (typeof ctorName === 'string' && byCtorName[ctorName]) ? byCtorName[ctorName] : null;
  },

  scoreFamilyCandidateConfig(candidateConfig, opts = {}) {
    if (!candidateConfig || typeof candidateConfig !== 'object') {
      throw new Error('ComposerFactory.scoreFamilyCandidateConfig: candidateConfig must be an object');
    }
    if (typeof candidateConfig.type !== 'string' || candidateConfig.type.length === 0) {
      throw new Error('ComposerFactory.scoreFamilyCandidateConfig: candidateConfig.type must be a non-empty string');
    }

    const previousType = this.inferComposerType(opts.previousComposer);
    const peerType = this.inferComposerType(opts.peerComposer);

    let score = 1;
    if (previousType && candidateConfig.type === previousType) score += 0.45;
    if (peerType && candidateConfig.type === peerType) score -= 0.35;
    if (previousType && peerType && previousType !== peerType && candidateConfig.type !== peerType) score += 0.1;

    if (!Number.isFinite(score)) {
      throw new Error('ComposerFactory.scoreFamilyCandidateConfig: computed score is not finite');
    }
    return m.max(0.05, score);
  },

  pickWeightedFamilyCandidateOrFail(candidateConfigs, opts = {}) {
    if (!Array.isArray(candidateConfigs) || candidateConfigs.length === 0) {
      throw new Error('ComposerFactory.pickWeightedFamilyCandidateOrFail: candidateConfigs must be a non-empty array');
    }

    const weights = candidateConfigs.map((cfg) => this.scoreFamilyCandidateConfig(cfg, opts));
    let total = 0;
    for (const w of weights) total += Number(w);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error('ComposerFactory.pickWeightedFamilyCandidateOrFail: candidate weights sum to non-positive value');
    }

    let roll = rf() * total;
    for (let i = 0; i < candidateConfigs.length; i++) {
      roll -= Number(weights[i]);
      if (roll <= 0) return candidateConfigs[i];
    }
    return candidateConfigs[candidateConfigs.length - 1];
  }
};
