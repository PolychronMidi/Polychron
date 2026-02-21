rhythmPriors = (function() {
  const modeToQuality = {
    ionian: 'major', dorian: 'dorian', phrygian: 'minor', lydian: 'major',
    mixolydian: 'mixolydian', aeolian: 'minor', locrian: 'minor', major: 'major', minor: 'minor'
  };

  function normalizeQualityOrNull(input) {
    if (typeof input !== 'string' || input.length === 0) return null;
    const normalized = String(input).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(modeToQuality, normalized)) return modeToQuality[normalized];
    if (normalized.includes('min')) return 'minor';
    if (normalized.includes('maj')) return 'major';
    return null;
  }

  function resolvePhase(opts = {}) {
    if (opts && typeof opts.phase === 'string' && opts.phase.length > 0) {
      return opts.phase;
    }

    if (opts && opts.phraseContext && typeof opts.phraseContext === 'object' && typeof opts.phraseContext.phase === 'string' && opts.phraseContext.phase.length > 0) {
      return opts.phraseContext.phase;
    }

    if (ComposerFactory.sharedPhraseArcManager && typeof ComposerFactory.sharedPhraseArcManager.getPhase === 'function') {
      const phase = ComposerFactory.sharedPhraseArcManager.getPhase();
      if (typeof phase === 'string' && phase.length > 0) {
        return phase;
      }
    }

    return 'development';
  }

  function resolveWeightOrDefault(table, key, fallback = 1) {
    const raw = table && Object.prototype.hasOwnProperty.call(table, key) ? Number(table[key]) : Number(fallback);
    if (!Number.isFinite(raw) || raw <= 0) return Number(fallback);
    return raw;
  }

  function getProfileOrFail(qualityInput) {
    if (!RHYTHM_PRIOR_TABLES) {
      throw new Error('rhythmPriors.getProfileOrFail: RHYTHM_PRIOR_TABLES is unavailable');
    }

    const quality = normalizeQualityOrNull(qualityInput);
    if (!quality) throw new Error(`rhythmPriors.getProfileOrFail: unsupported quality "${qualityInput}"`);

    const profile = RHYTHM_PRIOR_TABLES[quality];
    if (!profile || typeof profile !== 'object') {
      throw new Error(`rhythmPriors.getProfileOrFail: missing profile for quality "${quality}"`);
    }

    if (!profile.phaseMethodWeights || typeof profile.phaseMethodWeights !== 'object') {
      throw new Error(`rhythmPriors.getProfileOrFail: profile "${quality}" missing phaseMethodWeights`);
    }
    if (!profile.levelPhaseMultipliers || typeof profile.levelPhaseMultipliers !== 'object') {
      throw new Error(`rhythmPriors.getProfileOrFail: profile "${quality}" missing levelPhaseMultipliers`);
    }
    if (!profile.cadentialMethodWeights || typeof profile.cadentialMethodWeights !== 'object') {
      throw new Error(`rhythmPriors.getProfileOrFail: profile "${quality}" missing cadentialMethodWeights`);
    }

    return profile;
  }

  function cloneRhythmSpecMapOrFail(rhythms) {
    if (!rhythms || typeof rhythms !== 'object') {
      throw new Error('rhythmPriors.cloneRhythmSpecMapOrFail: rhythms must be an object');
    }

    const out = {};
    for (const [name, spec] of Object.entries(rhythms)) {
      if (!spec || typeof spec !== 'object') {
        throw new Error(`rhythmPriors.cloneRhythmSpecMapOrFail: invalid rhythm spec "${name}"`);
      }
      out[name] = Object.assign({}, spec);
      if (Array.isArray(spec.weights)) {
        out[name].weights = spec.weights.slice();
      }
    }
    return out;
  }

  /**
   * Bias rhythm pattern weights based on corpus-derived phase/method priors.
   * @param {Object} opts
   * @param {Object<string, {weights:number[], method:string, args:any}>} [opts.rhythms]
   * @param {string} [opts.level]
   * @param {string} [opts.phase]
   * @param {Object} [opts.phraseContext]
   * @param {string} [opts.quality]
   * @param {number} [opts.strength=0.7]
   * @param {boolean} [opts.atBoundary]
   * @returns {Object}
   */
  function getBiasedRhythms(opts = {}) {
    if (typeof opts !== 'object' || opts === null) {
      throw new Error('rhythmPriors.getBiasedRhythms: opts must be an object');
    }

    const rhythmsIn = cloneRhythmSpecMapOrFail(opts.rhythms);

    const qualityHint = (typeof opts.quality === 'string' && opts.quality.length > 0)
      ? opts.quality
      : (HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? HarmonicContext.getField('quality')
        : 'major';

    const quality = normalizeQualityOrNull(qualityHint);
    if (!quality) return rhythmsIn;

    const profile = getProfileOrFail(quality);
    const phase = resolvePhase(opts);
    const level = (typeof opts.level === 'string' && opts.level.length > 0) ? opts.level : 'beat';
    const strength = clamp(Number.isFinite(Number(opts.strength)) ? Number(opts.strength) : 0.7, 0, 1.5);

    const phaseMethodMap = (profile.phaseMethodWeights && profile.phaseMethodWeights[phase] && typeof profile.phaseMethodWeights[phase] === 'object')
      ? profile.phaseMethodWeights[phase]
      : {};

    const levelMap = (profile.levelPhaseMultipliers && profile.levelPhaseMultipliers[level] && typeof profile.levelPhaseMultipliers[level] === 'object')
      ? profile.levelPhaseMultipliers[level]
      : {};

    const levelPhaseWeight = resolveWeightOrDefault(levelMap, phase, 1);
    const atBoundary = Boolean(
      opts.atBoundary === true ||
      (opts.phraseContext && typeof opts.phraseContext === 'object' && opts.phraseContext.atBoundary === true)
    );

    const out = {};
    for (const [name, spec] of Object.entries(rhythmsIn)) {
      if (!spec || typeof spec !== 'object') {
        throw new Error(`rhythmPriors.getBiasedRhythms: invalid rhythm spec "${name}"`);
      }
      if (typeof spec.method !== 'string' || spec.method.length === 0 || !Array.isArray(spec.weights) || spec.weights.length === 0) {
        out[name] = spec;
        continue;
      }

      const methodWeight = resolveWeightOrDefault(phaseMethodMap, spec.method, 1);
      const cadenceWeight = atBoundary
        ? resolveWeightOrDefault(profile.cadentialMethodWeights, spec.method, 1)
        : 1;

      const targetMultiplier = methodWeight * levelPhaseWeight * cadenceWeight;
      const blendedMultiplier = clamp(1 + (targetMultiplier - 1) * strength, 0.35, 3.2);

      out[name] = Object.assign({}, spec, {
        weights: spec.weights.map((weight) => {
          const base = Number.isFinite(Number(weight)) ? Number(weight) : 0.1;
          return m.max(0.05, base * blendedMultiplier);
        })
      });
    }

    return out;
  }

  return {
    normalizeQualityOrNull,
    getProfileOrFail,
    getBiasedRhythms
  };
})();
