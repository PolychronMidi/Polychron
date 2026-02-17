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

    if (typeof ComposerFactory !== 'undefined' && ComposerFactory && ComposerFactory.sharedPhraseArcManager && typeof ComposerFactory.sharedPhraseArcManager.getPhase === 'function') {
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

  function weightedAdjustment(weight, scale) {
    if (!Number.isFinite(Number(weight)) || !Number.isFinite(Number(scale))) return 0;
    const w = Number(weight);
    const s = Number(scale);
    if (w >= 1) return -(w - 1) * s;
    return (1 - w) * s;
  }

  function getProfileOrFail(qualityInput) {
    if (typeof MELODIC_PRIOR_TABLES === 'undefined' || !MELODIC_PRIOR_TABLES || typeof MELODIC_PRIOR_TABLES !== 'object') {
      throw new Error('melodicPriors.getProfileOrFail: MELODIC_PRIOR_TABLES is unavailable');
    }

    const quality = normalizeQualityOrNull(qualityInput);
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
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? HarmonicContext.getField('key')
        : null;

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
      : (typeof HarmonicContext !== 'undefined' && HarmonicContext && typeof HarmonicContext.getField === 'function')
        ? HarmonicContext.getField('quality')
        : 'major';

    const quality = normalizeQualityOrNull(qualityHint);
    if (!quality) return /** @type {{ [note: number]: number }} */ ({});

    const profile = getProfileOrFail(quality);
    const phase = resolvePhase(opts);
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
      const degreeWeight = resolveWeightOrDefault(phaseMap, String(degree), 1);
      let adjustment = weightedAdjustment(degreeWeight, 1.5 * strength);

      if (fromDegree !== null) {
        const tendencyKey = `${fromDegree}->${degree}`;
        const tendencyWeight = resolveWeightOrDefault(profile.tendencyWeights, tendencyKey, 1);
        adjustment += weightedAdjustment(tendencyWeight, 1.1 * strength);
      }

      out[note] = clamp(1 - adjustment, 0.1, 3.2);
    }

    return out;
  }

  return {
    normalizeQualityOrNull,
    getProfileOrFail,
    getCandidateWeights,
  };
})();
