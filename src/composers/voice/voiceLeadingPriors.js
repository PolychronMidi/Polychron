voiceLeadingPriors = (function() {
  /**
   * @typedef {Object} VoiceLeadingPriorsOpts
   * @property {number} [fromNote] - Starting MIDI note number
   * @property {number} [toNote] - Target MIDI note number
   * @property {string} [quality='major'] - Harmonic quality (major, minor, etc.)
   * @property {string} [phase] - Phrase phase (antecedent, consequent, etc.)
   * @property {string} [tonic] - Tonic key
   * @property {number} [strength=0.8] - Strength multiplier for adjustment (0-2)
   */

  function getProfileOrFail(qualityInput) {
    const quality = modeQualityMap.normalizeOrNull(qualityInput);
    if (!quality) throw new Error(`voiceLeadingPriors.getProfileOrFail: unsupported quality "${qualityInput}"`);

    const profile = VOICE_LEADING_PRIOR_TABLES[quality];
    if (!profile || typeof profile !== 'object') {
      throw new Error(`voiceLeadingPriors.getProfileOrFail: missing profile for quality "${quality}"`);
    }

    if (!profile.phaseIntervalWeights || typeof profile.phaseIntervalWeights !== 'object') {
      throw new Error(`voiceLeadingPriors.getProfileOrFail: profile "${quality}" missing phaseIntervalWeights`);
    }
    if (!profile.phaseDirectionWeights || typeof profile.phaseDirectionWeights !== 'object') {
      throw new Error(`voiceLeadingPriors.getProfileOrFail: profile "${quality}" missing phaseDirectionWeights`);
    }
    if (!profile.tendencyWeights || typeof profile.tendencyWeights !== 'object') {
      throw new Error(`voiceLeadingPriors.getProfileOrFail: profile "${quality}" missing tendencyWeights`);
    }

    return profile;
  }

  function resolveTonicPitchClass(opts = {}) {
    const tonic = (opts && typeof opts.tonic === 'string' && opts.tonic.length > 0)
      ? opts.tonic
      : (HarmonicContext && HarmonicContext.getField)
        ? HarmonicContext.getField('key')
        : null;

    if (typeof tonic !== 'string' || tonic.length === 0) return null;
    const chroma = t.Note.chroma(tonic);
    if (!Number.isFinite(Number(chroma))) return null;
    return ((Number(chroma) % 12) + 12) % 12;
  }

  /**
   * Computes corpus-derived adjustment for voice leading candidate scoring.
   * @param {VoiceLeadingPriorsOpts} opts - Options for adjustment calculation
   * @returns {number} Adjustment value to add to total cost (can be negative)
   */
  function getCandidateAdjustment(opts = {}) {
    if (!opts || typeof opts !== 'object') {
      throw new Error('voiceLeadingPriors.getCandidateAdjustment: opts must be an object');
    }
    if (!Number.isFinite(Number(opts.fromNote))) {
      throw new Error('voiceLeadingPriors.getCandidateAdjustment: opts.fromNote must be finite');
    }
    if (!Number.isFinite(Number(opts.toNote))) {
      throw new Error('voiceLeadingPriors.getCandidateAdjustment: opts.toNote must be finite');
    }

    const qualityHint = (typeof opts.quality === 'string' && opts.quality.length > 0)
      ? opts.quality
      : (HarmonicContext && HarmonicContext.getField)
        ? HarmonicContext.getField('quality')
        : 'major';

    const quality = modeQualityMap.normalizeOrNull(qualityHint);
    if (!quality) return 0;

    const profile = getProfileOrFail(quality);
    const phase = priorsHelpers.resolvePhase(opts);
    const intervalMap = (profile.phaseIntervalWeights && profile.phaseIntervalWeights[phase] && typeof profile.phaseIntervalWeights[phase] === 'object')
      ? profile.phaseIntervalWeights[phase]
      : {};
    const directionMap = (profile.phaseDirectionWeights && profile.phaseDirectionWeights[phase] && typeof profile.phaseDirectionWeights[phase] === 'object')
      ? profile.phaseDirectionWeights[phase]
      : {};

    const strength = clamp(Number.isFinite(Number(opts.strength)) ? Number(opts.strength) : 0.8, 0, 2);
    const from = Number(opts.fromNote);
    const to = Number(opts.toNote);

    const interval = m.min(12, m.abs(to - from));
    const direction = (to > from) ? 'up' : (to < from) ? 'down' : 'static';

    const intervalWeight = priorsHelpers.resolveWeightOrDefault(intervalMap, String(interval), 1);
    const directionWeight = priorsHelpers.resolveWeightOrDefault(directionMap, direction, 1);

    let adjustment = 0;
    adjustment += priorsHelpers.weightedAdjustment(intervalWeight, 2.0 * strength);
    adjustment += priorsHelpers.weightedAdjustment(directionWeight, 1.4 * strength);

    const tonicPc = resolveTonicPitchClass(opts);
    if (Number.isFinite(Number(tonicPc))) {
      const fromPc = ((from % 12) + 12) % 12;
      const toPc = ((to % 12) + 12) % 12;
      const fromDegree = (fromPc - Number(tonicPc) + 12) % 12;
      const toDegree = (toPc - Number(tonicPc) + 12) % 12;
      const tendencyKey = `${fromDegree}->${toDegree}`;
      const tendencyWeight = priorsHelpers.resolveWeightOrDefault(profile.tendencyWeights, tendencyKey, 1);
      adjustment += priorsHelpers.weightedAdjustment(tendencyWeight, 1.8 * strength);
    }

    return clamp(adjustment, -6, 6);
  }

  return {
    getProfileOrFail,
    getCandidateAdjustment
  };
})();
