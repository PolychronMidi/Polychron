melodicPriors = (function() {
  /**
   * @typedef {Object} MelodicPriorsOpts
   * @property {number[]} candidates - Candidate MIDI notes
   * @property {number} [lastNote] - Previous MIDI note (optional)
   * @property {string} [quality='major'] - Harmonic quality or mode
   * @property {string} [phase] - Phrase phase
   * @property {Object} [phraseContext] - Phrase context (optional)
   * @property {string} [tonic] - Tonic key name
   * @property {number} [strength=0.8] - Prior strength from 0..2
   */

  function getProfileOrFail(qualityInput) {
    const quality = modeQualityMap.normalizeOrNull(qualityInput);
    if (!quality) throw new Error(`melodicPriors.getProfileOrFail: unsupported quality "${qualityInput}"`);

    const profile = MELODIC_PRIOR_TABLES[quality];
    if (!profile || typeof profile !== 'object') {
      throw new Error(`melodicPriors.getProfileOrFail: missing profile for quality "${quality}"`);
    }

    if (!profile.phaseDegreeWeights || typeof profile.phaseDegreeWeights !== 'object') {
      throw new Error(`melodicPriors.getProfileOrFail: profile "${quality}" missing phaseDegreeWeights`);
    }
    if (!profile.tendencyWeights || typeof profile.tendencyWeights !== 'object') {
      throw new Error(`melodicPriors.getProfileOrFail: profile "${quality}" missing tendencyWeights`);
    }

    return profile;
  }

  function resolveTonicPitchClass(opts = {}) {
    const tonic = (opts && typeof opts.tonic === 'string' && opts.tonic.length > 0)
      ? opts.tonic
      : (harmonicContext.getField('key') || null);

    if (typeof tonic !== 'string' || tonic.length === 0) return null;
    const chroma = t.Note.chroma(tonic);
    if (!Number.isFinite(Number(chroma))) return null;
    return ((Number(chroma) % 12) + 12) % 12;
  }

  /**
   * Build candidate weight multipliers using corpus melodic priors.
   * @param {MelodicPriorsOpts} opts
   * @returns {{ [note: number]: number }}
   */
  function getCandidateWeights(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new Error('melodicPriors.getCandidateWeights: opts must be an object');
    }
    if (!Array.isArray(opts.candidates) || opts.candidates.length === 0) {
      throw new Error('melodicPriors.getCandidateWeights: opts.candidates must be a non-empty array');
    }

    const candidates = opts.candidates.map((candidate, idx) => {
      if (!Number.isFinite(Number(candidate))) {
        throw new Error(`melodicPriors.getCandidateWeights: opts.candidates[${idx}] must be finite`);
      }
      return Number(candidate);
    });

    const qualityHint = (typeof opts.quality === 'string' && opts.quality.length > 0)
      ? opts.quality
      : (harmonicContext.getField('quality') || 'major');

    const quality = modeQualityMap.normalizeOrNull(qualityHint);
    if (!quality) return /** @type {{ [note: number]: number }} */ ({});

    const profile = getProfileOrFail(quality);
    const phase = priorsHelpers.resolvePhase(opts);
    const phaseMap = (profile.phaseDegreeWeights && profile.phaseDegreeWeights[phase] && typeof profile.phaseDegreeWeights[phase] === 'object')
      ? profile.phaseDegreeWeights[phase]
      : {};

    const strength = clamp(Number.isFinite(Number(opts.strength)) ? Number(opts.strength) : 0.8, 0, 2);
    const tonicPc = resolveTonicPitchClass(opts);
    if (!Number.isFinite(Number(tonicPc))) return /** @type {{ [note: number]: number }} */ ({});

    const hasLastNote = Number.isFinite(Number(opts.lastNote));
    const fromDegree = hasLastNote
      ? (((Number(opts.lastNote) % 12) - Number(tonicPc) + 12) % 12)
      : null;

    const out = /** @type {{ [note: number]: number }} */ ({});
    for (const note of candidates) {
      const degree = (((note % 12) - Number(tonicPc) + 12) % 12);
      const degreeWeight = priorsHelpers.resolveWeightOrDefault(phaseMap, String(degree), 1);
      let adjustment = priorsHelpers.weightedAdjustment(degreeWeight, 1.5 * strength);

      if (fromDegree !== null) {
        const tendencyKey = `${fromDegree}->${degree}`;
        const tendencyWeight = priorsHelpers.resolveWeightOrDefault(profile.tendencyWeights, tendencyKey, 1);
        adjustment += priorsHelpers.weightedAdjustment(tendencyWeight, 1.1 * strength);
      }

      out[note] = clamp(1 - adjustment, 0.1, 3.2);
    }

    return out;
  }

  return {
    getProfileOrFail,
    getCandidateWeights,
  };
})();
