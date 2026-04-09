voiceLeadingPriors = (function() {
  const V = validator.create('voiceLeadingPriors');
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
    V.assertObject(profile, 'getProfileOrFail.profile');
    V.assertObject(profile.phaseIntervalWeights, 'getProfileOrFail.phaseIntervalWeights');
    V.assertObject(profile.phaseDirectionWeights, 'getProfileOrFail.phaseDirectionWeights');
    V.assertObject(profile.tendencyWeights, 'getProfileOrFail.tendencyWeights');

    return profile;
  }

  function resolveTonicPitchClass(opts = {}) {
    const tonic = V.optionalType(opts.tonic, 'string')
      || harmonicContext.getField('key') || null;

    if (tonic === null || tonic.length === 0) return null;
    const chroma = t.Note.chroma(tonic);
    if (V.optionalFinite(Number(chroma)) === undefined) return null;
    return ((Number(chroma) % 12) + 12) % 12;
  }

  /**
   * Computes corpus-derived adjustment for voice leading candidate scoring.
   * @param {VoiceLeadingPriorsOpts} opts - Options for adjustment calculation
   * @returns {number} Adjustment value to add to total cost (can be negative)
   */
  function getCandidateAdjustment(opts = {}) {
    V.assertPlainObject(opts, 'getCandidateAdjustment.opts');
    V.requireFinite(Number(opts.fromNote), 'getCandidateAdjustment.fromNote');
    V.requireFinite(Number(opts.toNote), 'getCandidateAdjustment.toNote');

    const qualityHint = V.optionalType(opts.quality, 'string')
      || harmonicContext.getField('quality') || 'major';

    const quality = modeQualityMap.normalizeOrNull(qualityHint);
    if (!quality) return 0;

    const profile = getProfileOrFail(quality);
    const phase = priorsHelpers.resolvePhase(opts);
    const intervalMap = (profile.phaseIntervalWeights && profile.phaseIntervalWeights[phase] && V.optionalType(profile.phaseIntervalWeights[phase], 'object'))
      ? profile.phaseIntervalWeights[phase]
      : {};
    const directionMap = (profile.phaseDirectionWeights && profile.phaseDirectionWeights[phase] && V.optionalType(profile.phaseDirectionWeights[phase], 'object'))
      ? profile.phaseDirectionWeights[phase]
      : {};

    const strength = clamp(V.optionalFinite(Number(opts.strength), 0.8), 0, 2);
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
