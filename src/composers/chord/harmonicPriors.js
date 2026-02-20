harmonicPriors = (function() {
  const modeToQuality = {
    ionian: 'major', dorian: 'dorian', phrygian: 'minor', lydian: 'major',
    mixolydian: 'mixolydian', aeolian: 'minor', locrian: 'minor', major: 'major', minor: 'minor'
  };

  const cadenceTargetsByPhase = {
    opening: ['plagal', 'half'],
    development: ['deceptive', 'half'],
    climax: ['authentic', 'deceptive'],
    resolution: ['authentic', 'plagal']
  };

  const cadenceStrengthByPhase = {
    opening: 0.2,
    development: 0.35,
    climax: 0.65,
    resolution: 0.95
  };

  function normalizeQualityOrFail(input) {
    if (typeof input !== 'string' || input.length === 0) {
      throw new Error('harmonicPriors.normalizeQualityOrFail: quality must be a non-empty string');
    }
    const normalized = String(input).toLowerCase();
    const quality = modeToQuality[normalized];
    if (!quality) {
      throw new Error(`harmonicPriors.normalizeQualityOrFail: unknown quality or mode "${input}"`);
    }
    return quality;
  }

  function getProfileOrFail(qualityInput) {
    if (typeof HARMONIC_PRIOR_TABLES === 'undefined' || !HARMONIC_PRIOR_TABLES || typeof HARMONIC_PRIOR_TABLES !== 'object') {
      throw new Error('harmonicPriors.getProfileOrFail: HARMONIC_PRIOR_TABLES is unavailable');
    }
    const quality = normalizeQualityOrFail(qualityInput);
    const profile = HARMONIC_PRIOR_TABLES[quality];
    if (!profile || typeof profile !== 'object') {
      throw new Error(`harmonicPriors.getProfileOrFail: missing profile for quality "${quality}"`);
    }
    if (!profile.patterns || typeof profile.patterns !== 'object') {
      throw new Error(`harmonicPriors.getProfileOrFail: profile "${quality}" has invalid patterns map`);
    }
    return profile;
  }

  function resolvePhase(opts = {}) {
    if (opts && typeof opts.phase === 'string' && opts.phase.length > 0) {
      return opts.phase;
    }

    if (ComposerFactory && ComposerFactory.sharedPhraseArcManager && typeof ComposerFactory.sharedPhraseArcManager.getPhase === 'function') {
      const phase = ComposerFactory.sharedPhraseArcManager.getPhase();
      if (typeof phase === 'string' && phase.length > 0) {
        return phase;
      }
    }

    return 'development';
  }

  function resolveCadenceStrength(phase, opts = {}) {
    if (opts && Number.isFinite(Number(opts.cadenceStrength))) {
      return clamp(Number(opts.cadenceStrength), 0, 1);
    }
    const byPhase = cadenceStrengthByPhase[phase];
    if (Number.isFinite(Number(byPhase))) {
      return clamp(Number(byPhase), 0, 1);
    }
    return 0.4;
  }

  function resolveCadenceTargets(phase, opts = {}) {
    if (opts && Array.isArray(opts.targetCadences) && opts.targetCadences.length > 0) {
      return opts.targetCadences.filter((x) => typeof x === 'string' && x.length > 0);
    }
    return cadenceTargetsByPhase[phase] || ['authentic', 'plagal'];
  }

  function weightedChoiceOrFail(weightedEntries, label) {
    if (!Array.isArray(weightedEntries) || weightedEntries.length === 0) {
      throw new Error(`${label}: weightedEntries must be a non-empty array`);
    }

    let total = 0;
    for (const entry of weightedEntries) {
      total += Number(entry.weight);
    }
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(`${label}: total weight must be positive`);
    }

    let roll = rf() * total;
    for (const entry of weightedEntries) {
      roll -= Number(entry.weight);
      if (roll <= 0) return entry;
    }
    return weightedEntries[weightedEntries.length - 1];
  }

  function getPatternSet(qualityInput) {
    const profile = getProfileOrFail(qualityInput);
    const out = {};
    for (const [patternName, details] of Object.entries(profile.patterns)) {
      if (!details || typeof details !== 'object') {
        throw new Error(`harmonicPriors.getPatternSet: invalid details for pattern "${patternName}"`);
      }
      const romans = details.romans;
      if (!Array.isArray(romans) || romans.length === 0) {
        throw new Error(`harmonicPriors.getPatternSet: pattern "${patternName}" must define non-empty romans array`);
      }
      out[patternName] = romans.slice();
    }
    return out;
  }

  function getRomanProgression(qualityInput = 'major', opts = {}) {
    const quality = normalizeQualityOrFail(qualityInput);
    const profile = getProfileOrFail(quality);
    const phase = resolvePhase(opts);
    const cadenceStrength = resolveCadenceStrength(phase, opts);
    const targetCadences = resolveCadenceTargets(phase, opts);
    const phaseWeights = (profile.phaseWeights && profile.phaseWeights[phase] && typeof profile.phaseWeights[phase] === 'object')
      ? profile.phaseWeights[phase]
      : {};

    const weightedEntries = [];
    for (const [name, details] of Object.entries(profile.patterns)) {
      if (!details || typeof details !== 'object') continue;
      const romans = details.romans;
      if (!Array.isArray(romans) || romans.length === 0) continue;

      let weight = Number(details.baseWeight);
      if (!Number.isFinite(weight) || weight <= 0) weight = 1;

      const phaseWeight = Number(phaseWeights[name]);
      if (Number.isFinite(phaseWeight) && phaseWeight > 0) {
        weight *= phaseWeight;
      }

      const cadence = (typeof details.cadence === 'string') ? details.cadence : 'none';
      const cadential = details.cadential === true;
      if (cadential) {
        weight *= (1 + cadenceStrength * 0.6);
      }
      if (targetCadences.includes(cadence)) {
        weight *= (1 + cadenceStrength * 0.8);
      }

      if (opts && opts.excludeCadential === true && cadential) {
        weight *= 0.35;
      }

      weightedEntries.push({
        name,
        romans: romans.slice(),
        cadence,
        cadential,
        weight: m.max(0.01, weight)
      });
    }

    if (weightedEntries.length === 0) {
      throw new Error(`harmonicPriors.getRomanProgression: no weighted entries for quality "${quality}"`);
    }

    const selected = weightedChoiceOrFail(weightedEntries, 'harmonicPriors.getRomanProgression');
    return {
      quality,
      phase,
      cadenceStrength,
      patternName: selected.name,
      cadence: selected.cadence,
      cadential: selected.cadential,
      romans: selected.romans.slice()
    };
  }

  function listPatternNames(qualityInput = 'major') {
    return Object.keys(getPatternSet(qualityInput));
  }

  return {
    normalizeQualityOrFail,
    getPatternSet,
    getRomanProgression,
    listPatternNames
  };
})();
