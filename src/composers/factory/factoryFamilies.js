const V = validator.create('factoryFamilies');

factoryFamilies = {
  getComposerFamiliesOrFail(constructors) {
    V.assertObject(constructors, 'constructors');
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
      throw new Error('FactoryManager.getComposerFamiliesOrFail: no composer families configured');
    }

    for (const familyName of familyNames) {
      const family = source[familyName];
      V.assertObject(family, `family "${familyName}"`);
      const types = Array.isArray(family.types) ? family.types : null;
      if (!types || types.length === 0) {
        throw new Error(`FactoryManager.getComposerFamiliesOrFail: family "${familyName}" must define a non-empty types array`);
      }

      const normalizedTypes = [];
      for (const type of types) {
        V.assertNonEmptyString(type, `family "${familyName}" type entry`);
        if (!validTypes.has(type)) {
          throw new Error(`FactoryManager.getComposerFamiliesOrFail: family "${familyName}" references unknown composer type "${type}"`);
        }
        if (!normalizedTypes.includes(type)) normalizedTypes.push(type);
      }

      const weight = Number(family.weight);
      // Apply conductor profile family weight multiplier if available
      const profileWeights = (conductorConfig && conductorConfig.getFamilyWeights)
        ? conductorConfig.getFamilyWeights() : {};
      // Trust ecology character bias: dominant trust system boosts its associated family
      const biasedWeights = /** @type {Record<string, number>} */ (safePreBoot.call(() => trustEcologyCharacter.biasWeights(profileWeights), profileWeights));
      // R24: section memory trend bias - previous section's momentum shapes families
      const TREND_FAMILY_BIAS = {
        rising: { development: 1.4, harmonicMotion: 1.3, rhythmicDrive: 1.2 },
        falling: { diatonicCore: 1.5, tonalExploration: 1.3 },
        steady: {}
      };
      const prevSection = safePreBoot.call(() => sectionMemory.getPrevious(), null);
      const trendBias = (prevSection && prevSection.trend && TREND_FAMILY_BIAS[prevSection.trend])
        ? (TREND_FAMILY_BIAS[prevSection.trend][familyName] ?? 1.0) : 1.0;
      // Preserve explicit 0-weights (family disabled) instead of collapsing
      // them to 1 via `|| 1` -- Number.isFinite catches undefined/NaN from
      // a missing key but keeps a legitimate 0 intact.
      const _biased = Number(biasedWeights[familyName]);
      const profileMultiplier = (Number.isFinite(_biased) ? _biased : 1) * trendBias;
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
    if (extraConfig !== undefined) V.assertObject(extraConfig, 'extraConfig');
    if (composerCtx !== null && composerCtx !== undefined) V.assertObject(composerCtx, 'composerCtx');

    const families = this.getComposerFamiliesOrFail(constructors);
    const context = composerCtx ? composerCtx : (sharedComposerCtx ? sharedComposerCtx : null);

    let requestedFamily = extraConfig.phraseFamily ?? extraConfig.composerFamily;
    if ((requestedFamily === undefined || requestedFamily === null) && context && context.phraseFamily) {
      requestedFamily = context.phraseFamily;
    }

    if ((requestedFamily === undefined || requestedFamily === null) && context && context.selectPhraseFamily) {
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
      V.assertNonEmptyString(requestedFamily, 'requestedFamily');
      if (!Object.prototype.hasOwnProperty.call(families, requestedFamily)) {
        throw new Error(`FactoryManager.resolvePhraseFamilyOrFail: unknown family "${requestedFamily}"`);
      }
      return requestedFamily;
    }

    const familyNames = Object.keys(families);
    let totalWeight = 0;
    for (const familyName of familyNames) {
      totalWeight += Number(families[familyName].weight);
    }
    V.requireFinite(totalWeight, 'totalWeight');
    if (totalWeight <= 0) {
      throw new Error('FactoryManager.resolvePhraseFamilyOrFail: family weights must sum to a positive finite number');
    }

    // Apply composer feedback advisor quality-driven weight adjustments
    const advisorWeights = composerFeedbackAdvisor.getFamilyWeightAdjustments(familyNames);
    let advisedTotal = 0;
    for (const familyName of familyNames) {
      const advisorMult = Number(advisorWeights[familyName]);
      const mult = Number.isFinite(advisorMult) ? advisorMult : 1;
      advisedTotal += Number(families[familyName].weight) * mult;
    }
    V.requireFinite(advisedTotal, 'advisedTotal');
    if (advisedTotal <= 0) {
      throw new Error('FactoryManager.resolvePhraseFamilyOrFail: advised family weights sum to non-positive value');
    }

    let roll = rf() * advisedTotal;
    for (const familyName of familyNames) {
      const advisorMult = Number(advisorWeights[familyName]);
      const mult = Number.isFinite(advisorMult) ? advisorMult : 1;
      roll -= Number(families[familyName].weight) * mult;
      if (roll <= 0) return familyName;
    }
    return familyNames[familyNames.length - 1];
  },

  inferComposerType(composerInstance) {
    V.assertObject(composerInstance, 'composerInstance');
    if (composerInstance.factoryFamiliesFactoryType) {
      return composerInstance.factoryFamiliesFactoryType;
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
    const type = (ctorName && byCtorName[ctorName]) ? byCtorName[ctorName] : null;
    if (!type) {
      throw new Error(`FactoryManager.inferComposerType: unable to infer type for composer instance`);
    }
    return type;
  },

  scoreFamilyCandidateConfig(candidateConfig, opts = {}) {
    V.assertObject(candidateConfig, 'candidateConfig');
    V.assertNonEmptyString(candidateConfig.type, 'candidateConfig.type');

    const previousType = opts.previousComposer ? this.inferComposerType(opts.previousComposer) : null;
    const peerType = opts.peerComposer ? this.inferComposerType(opts.peerComposer) : null;

    let score = 1;
    // R14 E4: Reduce same-as-previous continuity bonus (0.45->0.25) and boost
    // different-from-peer bonus (0.10->0.20) for more composer type variety.
    if (previousType && candidateConfig.type === previousType) score += 0.25;
    if (peerType && candidateConfig.type === peerType) score -= 0.35;
    if (previousType && peerType && previousType !== peerType && candidateConfig.type !== peerType) score += 0.20;

    // Layer quality-driven adjustment from composerFeedbackAdvisor
    score *= composerFeedbackAdvisor.scoreCandidateAdjustment(candidateConfig);

    V.requireFinite(score, 'score');
    return m.max(0.05, score);
  },

  pickWeightedFamilyCandidateOrFail(candidateConfigs, opts = {}) {
    V.assertArray(candidateConfigs, 'candidateConfigs');
    if (candidateConfigs.length === 0) {
      throw new Error('FactoryManager.pickWeightedFamilyCandidateOrFail: candidateConfigs must be a non-empty array');
    }

    const weights = candidateConfigs.map((cfg) => this.scoreFamilyCandidateConfig(cfg, opts));
    let total = 0;
    for (const w of weights) total += Number(w);
    V.requireFinite(total, 'total');
    if (total <= 0) {
      throw new Error('FactoryManager.pickWeightedFamilyCandidateOrFail: candidate weights sum to non-positive value');
    }

    let roll = rf() * total;
    for (let i = 0; i < candidateConfigs.length; i++) {
      roll -= Number(weights[i]);
      if (roll <= 0) return candidateConfigs[i];
    }
    return candidateConfigs[candidateConfigs.length - 1];
  }
};
