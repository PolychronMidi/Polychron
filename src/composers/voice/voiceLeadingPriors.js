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

    if (typeof ComposerFactory !== 'undefined' && ComposerFactory && ComposerFactory.sharedPhraseArcManager && typeof ComposerFactory.sharedPhraseArcManager.getPhase === 'function') {
      const phase = ComposerFactory.sharedPhraseArcManager.getPhase();
      if (typeof phase === 'string' && phase.length > 0) {
        return phase;
      }
    }

    return 'development';
  }

  function getProfileOrFail(qualityInput) {
    if (typeof VOICE_LEADING_PRIOR_TABLES === 'undefined' || !VOICE_LEADING_PRIOR_TABLES || typeof VOICE_LEADING_PRIOR_TABLES !== 'object') {
      throw new Error('voiceLeadingPriors.getProfileOrFail: VOICE_LEADING_PRIOR_TABLES is unavailable');
    }

    const quality = normalizeQualityOrNull(qualityInput);
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
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? HarmonicContext.getField('key')
        : null;

    if (typeof tonic !== 'string' || tonic.length === 0) return null;
    const chroma = t.Note.chroma(tonic);
    if (!Number.isFinite(Number(chroma))) return null;
    return ((Number(chroma) % 12) + 12) % 12;
  }

  function resolveWeightOrDefault(table, key, fallback = 1) {
    const raw = table && Object.prototype.hasOwnProperty.call(table, key) ? Number(table[key]) : Number(fallback);
    if (!Number.isFinite(raw) || raw <= 0) return Number(fallback);
    return raw;
  }

  function weightedAdjustment(weight, scale) {
    if (!Number.isFinite(Number(weight)) || !Number.isFinite(Number(scale))) return 0;
    const w = Number(weight);
    const s = Number(scale);
    if (w >= 1) return -(w - 1) * s;
    return (1 - w) * s;
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
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? HarmonicContext.getField('quality')
        : 'major';

    const quality = normalizeQualityOrNull(qualityHint);
    if (!quality) return 0;

    const profile = getProfileOrFail(quality);
    const phase = resolvePhase(opts);
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

    const intervalWeight = resolveWeightOrDefault(intervalMap, String(interval), 1);
    const directionWeight = resolveWeightOrDefault(directionMap, direction, 1);

    let adjustment = 0;
    adjustment += weightedAdjustment(intervalWeight, 2.0 * strength);
    adjustment += weightedAdjustment(directionWeight, 1.4 * strength);

    const tonicPc = resolveTonicPitchClass(opts);
    if (Number.isFinite(Number(tonicPc))) {
      const fromPc = ((from % 12) + 12) % 12;
      const toPc = ((to % 12) + 12) % 12;
      const fromDegree = (fromPc - Number(tonicPc) + 12) % 12;
      const toDegree = (toPc - Number(tonicPc) + 12) % 12;
      const tendencyKey = `${fromDegree}->${toDegree}`;
      const tendencyWeight = resolveWeightOrDefault(profile.tendencyWeights, tendencyKey, 1);
      adjustment += weightedAdjustment(tendencyWeight, 1.8 * strength);
    }

    return clamp(adjustment, -6, 6);
  }

  return {
    normalizeQualityOrNull,
    getProfileOrFail,
    getCandidateAdjustment
  };
})();
