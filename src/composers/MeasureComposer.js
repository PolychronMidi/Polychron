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
    /** @type {VoiceLeadingScore|null} Optional voice leading optimizer */
    this.VoiceLeadingScore=null;
    /** @type {number[]} Historical notes for voice leading context */
    this.voiceHistory=[];
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
   * @param {number} [timeLimitMs=100] - Maximum wall-clock time before fallback
   * @returns {number[]} [numerator, denominator]
   * @throws {Error} When max iterations exceeded and no valid meter found
   */
  getMeter(ignoreRatioCheck=false, polyMeter=false, maxIterations=200, timeLimitMs=100) {
    // Constants for ratio validation
    const METER_RATIO_MIN = 0.25;
    const METER_RATIO_MAX = 4;
    const MIN_LOG_STEPS = 0.5;
    const FALLBACK_METER = [4, 4];

    let iterations=0;
    const maxLogSteps=polyMeter ? 4 : 2; // Log2 steps: 2 = ~4x ratio, 4 = ~16x ratio
    const startTs=Date.now();
    const _mStart = process.hrtime.bigint();

    while (++iterations <= maxIterations && (Date.now() - startTs) <= timeLimitMs) {
      let newNumerator=this.getNumerator();
      let newDenominator=this.getDenominator();

      // Validate numerator and denominator are positive integers
      if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
        continue;
      }

      let newMeterRatio=newNumerator / newDenominator;

      // Check if new meter ratio is within acceptable range
      const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

      if (ratioValid) {
        if (this.lastMeter) {
          let lastMeterRatio=this.lastMeter[0] / this.lastMeter[1];
          // Log ratio: 0 = same, 1 = 2x, 2 = 4x, 3 = 8x, 4 = 16x difference
          let logSteps=m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
          // Also enforce an absolute ratio change threshold to avoid large linear jumps
          const ratioChange = m.abs(newMeterRatio - lastMeterRatio);
          if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps && ratioChange <= 1.5) {
            this.lastMeter=[newNumerator,newDenominator];
            return this.lastMeter;
          }
        } else {
          this.lastMeter=[newNumerator,newDenominator];
          try { const _durMs = Number(process.hrtime.bigint() - _mStart) / 1e6; if (_durMs > 5) console.warn(`perf: getMeter slow ${_durMs.toFixed(2)}ms iterations=${iterations}`); } catch (e) { console.warn('MeasureComposer: perf diagnostic failed:', e && e.stack ? e.stack : e); }
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
    if (!Array.isArray(self.notes) || self.notes.length === 0) {
      throw new Error(`MeasureComposer.getNotes(): this.notes is invalid - composer=${this?.constructor?.name}, scale=${self?.scale?.name}, notes=${JSON.stringify(self?.notes)}`);
    }

    if (++self.recursionDepth > self.MAX_RECURSION) {
      throw new Error('MeasureComposer.getNotes() exceeded max recursion depth');
    }
    const [o1, o2]=octaveRange || self.getOctaveRange();
    const minOctave = Math.min(o1, o2);
    const maxOctave = Math.max(o1, o2);
    const rootNote=self.notes[ri(self.notes.length - 1)];

    // Delegate interval selection to universal strategy
    let intervals = [];
    try {
      const intervalOptions = self.intervalOptions || undefined;
      intervals = IntervalComposer.selectIntervals(self.notes.length, intervalOptions);
    } catch (e) {
      console.error('MeasureComposer.getNotes: IntervalComposer.selectIntervals failed:', e);
      throw e;
    }

    try {
      const notesOut = MeasureNotePool.buildNotePool(self.notes, intervals, [minOctave, maxOctave], rootNote);

      if (!Array.isArray(notesOut) || notesOut.length === 0) {
        throw new Error(`MeasureComposer.getNotes produced empty result: no valid notes generated for intervals [${intervals}], octaveRange ${JSON.stringify(octaveRange)}, rootNote ${rootNote}`);
      }

      return notesOut;
    } finally {
      this.recursionDepth--;
    }
  }

  /**
   * Enables voice leading optimization for this composer.
   * Accepts either a VoiceLeadingScore instance or a configuration object
   * to create one: `enableVoiceLeading({ commonToneWeight: 1 })`.
   * @param {VoiceLeadingScore|Object} [scorerOrConfig]
   * @returns {VoiceLeadingScore} the active scorer
   */
  enableVoiceLeading(scorerOrConfig) {
    if (!scorerOrConfig) {
      this.VoiceLeadingScore = new VoiceLeadingScore();
    } else if (typeof scorerOrConfig === 'object' && typeof scorerOrConfig.selectNextNote !== 'function') {
      // Treat as config
      this.VoiceLeadingScore = new VoiceLeadingScore(scorerOrConfig);
    } else {
      // Assume an instance
      this.VoiceLeadingScore = scorerOrConfig;
    }

    this.voiceHistory = [];
    return this.VoiceLeadingScore;
  }

  /**
   * Update voice leading configuration at runtime. If a scorer is present,
   * delegates to its updateConfig; otherwise creates a new scorer with cfg.
   * @param {Object} cfg
   * @returns {VoiceLeadingScore}
   */
  setVoiceLeadingConfig(cfg = {}) {
    if (!this.VoiceLeadingScore) this.enableVoiceLeading(cfg);
    else if (typeof this.VoiceLeadingScore.updateConfig === 'function') this.VoiceLeadingScore.updateConfig(cfg);
    return this.VoiceLeadingScore;
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
      return availableNotes?.[ri(availableNotes.length - 1)] ?? 60;
    }

    const selectedNote = this.VoiceLeadingScore.selectNextNote(this.voiceHistory, availableNotes, config);
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
}
