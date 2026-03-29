const V = validator.create('MeasureComposer');
/**
 * Composes meter-related values with randomization.
 * @class
 * @property {number[]|string[]} notes - scale notes for this composer
 * @property {{name?: string}} scale - scale metadata like name
 */
MeasureComposer = class MeasureComposer {
  constructor() {
    /** @type {number[]|null} Previous meter [numerator, denominator] */
    this.lastMeter=null;
    /** @type {number} Recursion depth counter for getNotes */
    this.recursionDepth=0;
    /** @type {number} Max allowed recursion depth */
    this.MAX_RECURSION=5;
    /** @type {VoiceLeadingScoreAPI|null} Optional voice leading optimizer */
    this.VoiceLeadingScore=null;
    /** @type {number[]} Historical notes for voice leading context */
    this.voiceHistory=[];
    /** @type {{preservesScale:boolean, mutatesPitchClasses:boolean, deterministic:boolean, notesReflectOutputSet:boolean, timeVaryingScaleContext:boolean}} */
    this.capabilities = {
      preservesScale: true,
      mutatesPitchClasses: false,
      deterministic: false,
      notesReflectOutputSet: false,
      timeVaryingScaleContext: false
    };
  }

  /**
   * Set/merge composer capability flags.
  * @param {{preservesScale?:boolean, mutatesPitchClasses?:boolean, deterministic?:boolean, notesReflectOutputSet?:boolean, timeVaryingScaleContext?:boolean}} next
  * @returns {{preservesScale:boolean, mutatesPitchClasses:boolean, deterministic:boolean, notesReflectOutputSet:boolean, timeVaryingScaleContext:boolean}}
   */
  setCapabilities(next = {}) {
    V.assertObject(next, 'capabilities');
    const merged = Object.assign({}, this.capabilities || {}, next);
    const validated = assertComposerCapabilities(merged);
    this.capabilities = validated;
    return this.capabilities;
  }

  /**
   * @returns {{preservesScale:boolean, mutatesPitchClasses:boolean, deterministic:boolean, notesReflectOutputSet:boolean, timeVaryingScaleContext:boolean}}
   */
  getCapabilities() {
    if (!this.capabilities) {
      this.capabilities = { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: false };
    }
    return Object.assign({}, this.capabilities);
  }

  /**
   * @param {'preservesScale'|'mutatesPitchClasses'|'deterministic'|'notesReflectOutputSet'|'timeVaryingScaleContext'} name
   * @returns {boolean}
   */
  hasCapability(name) {
    const caps = this.getCapabilities();
    if (!Object.prototype.hasOwnProperty.call(caps, name)) {
      throw new Error(`MeasureComposer.hasCapability: unknown capability "${name}"`);
    }
    return Boolean(caps[name]);
  }
  /** @returns {number} Random numerator from NUMERATOR config */
  getNumerator(){const{min,max,weights}=NUMERATOR;return rw(min,max,weights);}
  /** @returns {number} Random denominator from DENOMINATOR config */
  getDenominator(){const{min,max,weights}=DENOMINATOR;return rw(min,max,weights);}
  /** @returns {number} Random divisions count from DIVISIONS config */
  getDivisions(){const{min,max,weights}=DIVISIONS;return rw(min,max,weights);}
  /** @returns {number} Random subdivs count from SUBDIVS config */
  getSubdivs(){const{min,max,weights}=SUBDIVS;return rw(min,max,weights);}
  /** @returns {number} Random sub-subdivs count from SUBSUBDIVS config */
  getSubsubdivs(){const{min,max,weights}=SUBSUBDIVS;return rw(min,max,weights);}
  /** @returns {number[]} Two octaves with minimum 2-3 octave difference */
  getOctaveRange() { const { min,max,weights }=OCTAVE;
  let [o1,o2]=[rw(min,max,weights),rw(min,max,weights)];
  while (m.abs(o1-o2)<ri(2,3)) { o2=modClamp(o2+ri(-3,3),min,max); }
  return [ o1,o2 ];
  }
  /**
   * Generates a valid meter [numerator, denominator] with log-based ratio check.
   * @param {boolean} [ignoreRatioCheck=false] - Skip ratio validation
   * @param {boolean} [polyMeter=false] - Allow larger ratio jumps for polyrhythm
   * @param {number} [maxIterations=200] - Maximum attempts before fallback
   * @returns {number[]} [numerator, denominator]
   * @throws {Error} When max iterations exceeded and no valid meter found
   */
  getMeter(ignoreRatioCheck=false, polyMeter=false, maxIterations=200) {
    // Constants for ratio validation
    const METER_RATIO_MIN = 0.25;
    const METER_RATIO_MAX = 4;
    const MIN_LOG_STEPS = 0.5;
    const FALLBACK_METER = [4, 4];
    let iterations=0;
    const maxLogSteps=polyMeter ? 4 : 2; // Log2 steps: 2 = ~4x ratio, 4 = ~16x ratio

    while (++iterations <= maxIterations) {
      const newNumerator=this.getNumerator();
      const newDenominator=this.getDenominator();
      const newMeterRatio=newNumerator / newDenominator;
      // Check if new meter ratio is within acceptable range
      const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

      if (ratioValid) {
        if (this.lastMeter) {
          const lastMeterRatio=this.lastMeter[0] / this.lastMeter[1];
          // Log ratio: 0 = same, 1 = 2x, 2 = 4x, 3 = 8x, 4 = 16x difference
          const logSteps=m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
          // Also enforce an absolute ratio change threshold to avoid large linear jumps
          const ratioChange = m.abs(newMeterRatio - lastMeterRatio);
          if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps && ratioChange <= 1.5) {
            this.lastMeter=[newNumerator,newDenominator];
            return this.lastMeter;
          }
        } else {
          this.lastMeter=[newNumerator,newDenominator];
          return this.lastMeter;
        }
      }
    }
    this.lastMeter=FALLBACK_METER;
    return this.lastMeter;
  }
  /**
   * Generates note objects within octave range.
   * Returns full note pool across all octaves (for use with VoiceManager).
   * @param {number[]|null} [octaveRange=null] - [min, max] octaves, or auto-generate
   * @returns {{note: number}[]} Array of note objects (full pool)
   */
  getNotes(octaveRange=null) {
    // Fail-fast: ensure this.notes exists and is non-empty
    const self = /** @type {any} */ (this);
    V.assertArray(self.notes, 'this.notes', true);

    if (++self.recursionDepth > self.MAX_RECURSION) {
      throw new Error('MeasureComposer.getNotes() exceeded max recursion depth');
    }
    const [o1, o2]=octaveRange || self.getOctaveRange();
    const minOctave = m.min(o1, o2);
    const maxOctave = m.max(o1, o2);
    const rootNote=self.notes[ri(self.notes.length - 1)];

    // Delegate interval selection to universal strategy
    let intervals = [];
    const intervalOptions = self.intervalOptions;
    intervals = intervalComposer.selectIntervals(self.notes.length, intervalOptions);

    try {
      const notesOut = measureNotePool.buildNotePool(self.notes, intervals, [minOctave, maxOctave], rootNote);

      V.assertArray(notesOut, 'notesOut', true);

      return notesOut;
    } finally {
      this.recursionDepth--;
    }
  }

  /**
   * Enables voice leading optimization for this composer.
   * Accepts either a VoiceLeadingScore instance or a configuration object
   * to create one: `enableVoiceLeading({ commonToneWeight: 1 })`.
   * @param {VoiceLeadingScoreAPI|Object} [scorerOrConfig]
   * @returns {VoiceLeadingScoreAPI} the active scorer
   */
  enableVoiceLeading(scorerOrConfig) {
    // Accept either a VoiceLeadingScore instance or a configuration object.
    // We validate more thoroughly than before to ensure the scorer has the
    // additional method required by `voiceRegistry` and `VoiceManager`.
    const validateInstance = (obj) => {
      V.assertObject(obj, 'scorer');
      V.requireType(obj.selectNextNote, 'function', 'scorer.selectNextNote');
      // voiceRegistryScoreCandidate is added via prototype helpers in
      // VoiceLeadingScore.js and is mandatory for multi-voice selection.  If
      // a caller mistakenly passes a partial object (e.g. just a config) it
      // will lack this method.  Validate here so we never cache an invalid
      // scorer and subsequently spam warnings.
      if (!V.optionalType(obj.voiceRegistryScoreCandidate, 'function')) {
        throw new Error('enableVoiceLeading: candidate object is missing voiceRegistryScoreCandidate');
      }
    };

    if (!scorerOrConfig) {
      this.VoiceLeadingScore = new VoiceLeadingScore();
    } else if (typeof scorerOrConfig === 'object') {
      try {
        validateInstance(scorerOrConfig);
        // looks like a real instance
        this.VoiceLeadingScore = scorerOrConfig;
      } catch { /* duck-type validation: input may be config instead of instance */
        // treat as configuration and build a new scorer
        this.VoiceLeadingScore = new VoiceLeadingScore(scorerOrConfig);
      }
    } else {
      // non-object values are assumed to be instances (could still be invalid,
      // but our downstream callers will guard again).
      try {
        validateInstance(scorerOrConfig);
      } catch { /* duck-type validation: input may be config instead of instance */
        // fall back to default scorer if validation fails
        this.VoiceLeadingScore = new VoiceLeadingScore();
        return /** @type {VoiceLeadingScoreAPI} */ (this.VoiceLeadingScore);
      }
      this.VoiceLeadingScore = scorerOrConfig;
    }

    this.voiceHistory = [];
    return /** @type {VoiceLeadingScoreAPI} */ (this.VoiceLeadingScore);
  }

  /**
   * Update voice leading configuration at runtime. If a scorer is present,
   * delegates to its updateConfig; otherwise creates a new scorer with cfg.
   * @param {Object} cfg
   * @returns {VoiceLeadingScoreAPI}
   */
  setVoiceLeadingConfig(cfg = {}) {
    if (!this.VoiceLeadingScore) {
      // if no scorer exists, treat config as basis for a new one
      this.enableVoiceLeading(cfg);
    } else if (typeof this.VoiceLeadingScore.updateConfig === 'function') {
      // update existing scorer in-place
      this.VoiceLeadingScore.updateConfig(cfg);
      // ensure update didn't somehow corrupt the object
      if (!this.VoiceLeadingScore || !this.VoiceLeadingScore.voiceRegistryScoreCandidate) {
        this.VoiceLeadingScore = new VoiceLeadingScore(cfg);
      }
    }
    return /** @type {VoiceLeadingScoreAPI} */ (this.VoiceLeadingScore);
  }

  /**
   * Disables voice leading optimization.
   * @returns {void}
   */
  disableVoiceLeading() {
    this.VoiceLeadingScore = null;
    this.voiceHistory = [];
  }

  /**
   * Selects the best note from available candidates using voice leading cost function.
   * Falls back to random selection if voice leading is disabled.
   * @param {number[]} availableNotes - Pool of candidate notes
   * @param {{ register?: string, constraints?: string[] }} [config] - Voice context
   * @returns {number} Selected note
   */
  selectNoteWithLeading(availableNotes, config = {}) {
    if (!this.VoiceLeadingScore || !availableNotes || availableNotes.length === 0) {
      if (!availableNotes || availableNotes.length === 0) {
        throw new Error('MeasureComposer.selectNoteWithLeading: availableNotes must be a non-empty array when voice leading is disabled');
      }
    }

    const scorer = /** @type {VoiceLeadingScoreAPI} */ (this.VoiceLeadingScore);
    const selectedNote = scorer.selectNextNote(this.voiceHistory, availableNotes, config);
    this.voiceHistory.push(selectedNote);

    // Keep history shallow for memory efficiency
    if (this.voiceHistory.length > 4) {
      this.voiceHistory.shift();
    }

    return selectedNote;
  }

  /**
   * Resets voice leading history (call at section boundaries).
   * @returns {void}
   */
  resetVoiceLeading() {
    this.voiceHistory = [];
    if (this.VoiceLeadingScore) {
      this.VoiceLeadingScore.reset();
    }
  }

  /**
   * Returns voicing intent for candidate notes based on this composer's pitch-class set.
   * Subclasses can override to add domain-specific logic (tension curves, development phases, etc.).
   * @param {number[]} candidateNotes - Available MIDI notes to weight
   * @returns {{ candidateWeights: { [note: number]: number }, registerBias?: string, voiceCountMultiplier?: number } | null}
   *   - candidateWeights: map of note - weight (higher = more preferred)
   *   - registerBias: optional 'higher' | 'lower' register hint
   *   - voiceCountMultiplier: optional voice count scaling factor
   */
  getVoicingIntent(candidateNotes = []) {
    if (!Array.isArray(candidateNotes) || candidateNotes.length === 0) return null;

    // Cast to any to access notes property (set by subclasses)
    const self = /** @type {any} */ (this);
    if (!Array.isArray(self.notes) || self.notes.length === 0) return null;

    // Use centralized PC-matching helper
    const candidateWeights = voiceLeadingCore.buildPCWeights(candidateNotes, self.notes, 1, 0);
    return { candidateWeights };
  }
}
