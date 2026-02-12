ComposerFactory = class ComposerFactory {
  // Shared phrase arc manager instance
  static sharedPhraseArcManager = null;
  // Shared composer context (passed from main.js)
  static sharedComposerCtx = null;

  /**
   * Set shared composer context (call from main.js before creating composers)
   * @param {Object} ctx - Context object { phraseArc, layerMgr, rhythmMgr, stutterMgr, noiseProfile }
   */
  static setComposerContext(ctx) {
    if (ctx && typeof ctx === 'object') {
      this.sharedComposerCtx = ctx;
    }
  }

  /**
   * Get or create shared PhraseArcManager
   * @param {Object} opts - Options for creating PhraseArcManager if needed
   * @returns {PhraseArcManager}
   */
  static getPhraseArcManager(opts = {}) {
    if (!this.sharedPhraseArcManager) {
      this.sharedPhraseArcManager = new PhraseArcManager(opts);
    }
    return this.sharedPhraseArcManager;
  }

  /**
   * Reset shared PhraseArcManager (call at section boundaries)
   */
  static resetPhraseArcManager() {
    if (this.sharedPhraseArcManager) {
      this.sharedPhraseArcManager.reset();
    }
  }

  static capabilityProfiles = {
    // mutatesPitchClasses means the composer can change its active pitch-class set over time.
    // preservesScale means generated notes should remain inside the currently active scale/chord context.
    measure: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: false },
    scale: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
    mode: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
    pentatonic: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
    voiceLeading: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
    chords: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
    harmonicRhythm: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
    tensionRelease: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
    modalInterchange: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
    melodicDevelopment: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
  };

  static validateCapabilityProfiles() {
    if (typeof assertComposerCapabilities !== 'function') throw new Error('ComposerFactory.validateCapabilityProfiles: assertComposerCapabilities() not available');
    const entries = Object.entries(this.capabilityProfiles || {});
    /** @type {any} */
    const normalized = {};
    for (const [type, profile] of entries) {
      try {
        normalized[type] = assertComposerCapabilities(profile);
      } catch (e) {
        throw new Error(`ComposerFactory.validateCapabilityProfiles: invalid profile for type "${type}": ${e && e.message ? e.message : e}`);
      }
    }
    this.capabilityProfiles = normalized;
    return this.capabilityProfiles;
  }

  static applyCapabilityContract(composer, type, config = {}) {
    if (!composer || typeof composer !== 'object') throw new Error('ComposerFactory.applyCapabilityContract: composer must be an object');

    const profile = this.capabilityProfiles[type] || { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: false };
    const fromComposer = (typeof composer.getCapabilities === 'function') ? composer.getCapabilities() : (composer.capabilities && typeof composer.capabilities === 'object' ? composer.capabilities : {});
    const fromConfig = (config && typeof config.capabilities === 'object' && config.capabilities !== null) ? config.capabilities : {};
    const merged = Object.assign({}, profile, fromComposer, fromConfig);
    if (typeof assertComposerCapabilities !== 'function') throw new Error('ComposerFactory.applyCapabilityContract: assertComposerCapabilities() not available');
    const validated = assertComposerCapabilities(merged);

    if (typeof composer.setCapabilities === 'function') {
      composer.setCapabilities(validated);
    } else {
      composer.capabilities = validated;
    }

    return composer;
  }

  static constructors = {
    measure: () => new MeasureComposer(),
    scale: ({ name = 'major', root = 'C' } = {}) => {
      if (!Array.isArray(allScales) || allScales.length === 0) throw new Error('ComposerFactory.scale: allScales not available');
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.scale: allNotes not available');
      const n = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      return new (ScaleComposer)(n, r);
    },
    chords: ({ progression = ['C'] } = {}) => {
      let p = progression;
      if (/** @type {any} */ (progression) === 'random') {
        if (!Array.isArray(allChords) || allChords.length === 0) throw new Error('ComposerFactory.chords: allChords not available');
        const len = ri(2, 5);
        p = [];
        for (let i = 0; i < len; i++) p.push(allChords[ri(allChords.length - 1)]);
      }
      // Normalize chord symbols; fail-fast if normalization fails
      if (Array.isArray(p)) {
        p = p.map(normalizeChordSymbol); // Will throw on invalid chord symbols
      }
      return new (ChordComposer)(p);
    },
    mode: ({ name = 'ionian', root = 'C' } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.mode: allNotes not available');
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      if (name === 'random') {
        // If root is also random, pick a precomputed valid pair ("C ionian") and split it
        if (root === 'random') {
          if (!Array.isArray(allModes) || allModes.length === 0) throw new Error('ComposerFactory.mode: allModes not available');
          const pair = allModes[ri(allModes.length - 1)];
          if (typeof pair === 'string' && pair.indexOf(' ') > -1) {
            const parts = pair.split(' ');
            const rootFromPair = parts[0];
            const modeName = parts.slice(1).join(' ');
            return new (ModeComposer)(modeName, rootFromPair);
          }
        }
        // Otherwise pick a random mode name and use the provided root
        const modeEntries = t.Mode.all();
        const modeEntry = modeEntries[ri(modeEntries.length - 1)];
        const modeName = (modeEntry && modeEntry.name) ? modeEntry.name : 'ionian';
        return new (ModeComposer)(modeName, r);
      }
      return new (ModeComposer)(name, r);
    },

    pentatonic: ({ root = 'C', scaleType = 'major' } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.pentatonic: allNotes not available');
      const r = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      return new (PentatonicComposer)(r, t);
    },
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5, enablePhraseArcs = true, phraseArcOpts = {} } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.tensionRelease: allNotes not available');
      const phraseArcManager = enablePhraseArcs ? ComposerFactory.getPhraseArcManager(phraseArcOpts) : null;
      return new TensionReleaseComposer(key, quality, tensionCurve, { phraseArcManager });
    },
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.modalInterchange: allNotes not available');
      return new ModalInterchangeComposer(key, primaryMode, borrowProbability);
    },
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major', changeEmphasis = 2.0, anticipation = false, settling = true, enablePhraseArcs = true, phraseArcOpts = {} } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.harmonicRhythm: allNotes not available');
      const k = key === 'random' ? allNotes[ri(allNotes.length - 1)] : key;
      const phraseArcManager = enablePhraseArcs ? ComposerFactory.getPhraseArcManager(phraseArcOpts) : null;
      return new HarmonicRhythmComposer(progression, k, measuresPerChord, quality, { changeEmphasis, anticipation, settling, phraseArcManager });
    },
    melodicDevelopment: ({ name = 'major', root = 'C', intensity = 0.5, developmentBias = 0.7, enablePhraseArcs = true, phraseArcOpts = {}, inversionMode = 'diatonic', inversionPivotMode = 'first-note', inversionFixedDegree = 0, normalizeToScale = true, useDegreeNoise = true } = {}) => {
      const phraseArcManager = enablePhraseArcs ? ComposerFactory.getPhraseArcManager(phraseArcOpts) : null;
      return new MelodicDevelopmentComposer(name, root, intensity, developmentBias, { phraseArcManager, inversionMode, inversionPivotMode, inversionFixedDegree, normalizeToScale, useDegreeNoise });
    },
    voiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) => new VoiceLeadingComposer(name, root, commonToneWeight),
  };

  static create(config = {}, ctx = null) {
    if (config !== undefined && (typeof config !== 'object' || config === null)) {
      throw new Error('ComposerFactory.create: config must be an object if provided');
    }
    const type = config.type || 'scale';
    const factory = this.constructors[type];
    if (!factory) {
      throw new Error(`ComposerFactory.create: unknown composer type "${type}"—fail-fast`);
    }
    // Set context if provided; fall back to shared context
    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);
    const composer = factory(config);
    return this.applyCapabilityContract(composer, type, config);
  }

  static createRandom(extraConfig = {}, ctx = null) {
    // Set context if provided; fall back to shared context
    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);

    // Fail-fast: COMPOSERS array must be defined and non-empty
    if (typeof COMPOSERS === 'undefined' || !Array.isArray(COMPOSERS) || COMPOSERS.length === 0) {
      throw new Error('ComposerFactory.createRandom: COMPOSERS array is undefined or empty');
    }

    // Try up to N composers from COMPOSERS; fail-fast if all attempts exhaust
    const maxAttempts = m.min(8, COMPOSERS.length);
    let lastError = null;

    for (let i = 0; i < maxAttempts; i++) {
      const cfg = COMPOSERS[ri(COMPOSERS.length - 1)];
      try {
        const composer = this.create(Object.assign({}, cfg, extraConfig), composerCtx);

        // Verify composer has getNotes method
        if (typeof composer.getNotes !== 'function') {
          throw new Error(`ComposerFactory.createRandom: created composer missing getNotes() method`);
        }

        // Verify composer can produce notes
        const notes = composer.getNotes();
        if (!Array.isArray(notes) || notes.length === 0) {
          throw new Error(`ComposerFactory.createRandom: composer.getNotes() returned empty or invalid array`);
        }

        return composer;
      } catch (e) {
        lastError = e;
        // Continue to next attempt
      }
    }

    // All attempts exhausted
    throw new Error(`ComposerFactory.createRandom: failed to create valid composer after ${maxAttempts} attempts. Last error: ${lastError && lastError.message ? lastError.message : lastError}`);
  }
}

ComposerFactory.validateCapabilityProfiles();
