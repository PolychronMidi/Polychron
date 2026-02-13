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

  static runtimeProfilePrecedence = {
    baseVelocity: ['chord', 'voice']
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

  static resolveRuntimeProfiles(config = {}) {
    if (config !== undefined && (typeof config !== 'object' || config === null)) {
      throw new Error('ComposerFactory.resolveRuntimeProfiles: config must be an object');
    }

    if (typeof ComposerProfileUtils === 'undefined' || !ComposerProfileUtils || typeof ComposerProfileUtils.resolveNamedProfilesOrFail !== 'function') {
      throw new Error('ComposerFactory.resolveRuntimeProfiles: ComposerProfileUtils.resolveNamedProfilesOrFail() not available');
    }

    return ComposerProfileUtils.resolveNamedProfilesOrFail(config, 'ComposerFactory.resolveRuntimeProfiles.config');
  }

  static applyRuntimeProfileConfig(composer, config = {}) {
    if (!composer || typeof composer !== 'object') throw new Error('ComposerFactory.applyRuntimeProfileConfig: composer must be an object');
    const runtimeProfiles = this.resolveRuntimeProfiles(config);
    if (Object.keys(runtimeProfiles).length === 0) return composer;

    composer.profileConfigs = Object.assign({}, composer.profileConfigs || {}, runtimeProfiles);

    const chord = runtimeProfiles.chord;
    const voice = runtimeProfiles.voice;
    const motif = runtimeProfiles.motif;
    const rhythm = runtimeProfiles.rhythm;

    if (chord && composer.intervalOptions && typeof composer.intervalOptions === 'object' && Array.isArray(composer.notes) && composer.notes.length > 0) {
      const voices = Number(chord.voices);
      if (Number.isFinite(voices)) {
        const boundedVoices = m.max(1, m.min(composer.notes.length, m.round(voices)));
        composer.intervalOptions.minNotes = boundedVoices;
        composer.intervalOptions.maxNotes = boundedVoices;
      }
    }

    if (chord && Number.isFinite(Number(chord.inversion))) {
      composer.chordInversionPreference = Number(chord.inversion);
      if (composer.intervalOptions && typeof composer.intervalOptions === 'object') {
        const sourceCount = Array.isArray(composer.notes) ? composer.notes.length : 0;
        if (sourceCount > 0) {
          const normalizedInversion = ((m.round(Number(chord.inversion)) % sourceCount) + sourceCount) % sourceCount;
          const priorPrefer = Array.isArray(composer.intervalOptions.preferIndices) ? composer.intervalOptions.preferIndices.slice() : [];
          if (!priorPrefer.includes(normalizedInversion)) {
            composer.intervalOptions.preferIndices = [normalizedInversion, ...priorPrefer];
          } else {
            composer.intervalOptions.preferIndices = priorPrefer;
          }
        }
      }
    }

    if (chord && Number.isFinite(Number(chord.velocityScale))) {
      composer.chordVelocityScale = Number(chord.velocityScale);
    }

    if (motif && Number.isFinite(Number(motif.velocityScale))) {
      composer.motifVelocityScale = Number(motif.velocityScale);
    }
    if (motif && Number.isFinite(Number(motif.timingOffset))) {
      composer.motifTimingOffset = Number(motif.timingOffset);
    }

    if (rhythm && Number.isFinite(Number(rhythm.swing))) {
      composer.rhythmSwing = Number(rhythm.swing);
    }
    if (rhythm && Number.isFinite(Number(rhythm.velocityScale))) {
      composer.rhythmVelocityScale = Number(rhythm.velocityScale);
    }

    const baseVelocityOrder = Array.isArray(this.runtimeProfilePrecedence.baseVelocity)
      ? this.runtimeProfilePrecedence.baseVelocity
      : ['chord', 'voice'];
    const baseVelocityBySource = {
      chord: chord && Number.isFinite(Number(chord.baseVelocity)) ? Number(chord.baseVelocity) : null,
      voice: voice && Number.isFinite(Number(voice.baseVelocity)) ? Number(voice.baseVelocity) : null
    };

    let selectedBaseVelocity = null;
    let selectedBaseVelocitySource = null;
    for (const source of baseVelocityOrder) {
      const value = baseVelocityBySource[source];
      if (Number.isFinite(value)) {
        selectedBaseVelocity = Number(value);
        selectedBaseVelocitySource = source;
      }
    }
    if (Number.isFinite(selectedBaseVelocity)) {
      composer.baseVelocity = Number(selectedBaseVelocity);
      composer.baseVelocitySource = selectedBaseVelocitySource;
    }

    const velocityScaleFactors = [];
    if (Number.isFinite(Number(composer.chordVelocityScale))) velocityScaleFactors.push(Number(composer.chordVelocityScale));
    if (Number.isFinite(Number(composer.motifVelocityScale))) velocityScaleFactors.push(Number(composer.motifVelocityScale));
    if (Number.isFinite(Number(composer.rhythmVelocityScale))) velocityScaleFactors.push(Number(composer.rhythmVelocityScale));
    composer.profileVelocityScale = velocityScaleFactors.length > 0
      ? velocityScaleFactors.reduce((acc, value) => acc * value, 1)
      : 1;

    composer.profileTimingOffsetUnits = Number.isFinite(Number(composer.motifTimingOffset)) ? Number(composer.motifTimingOffset) : 0;
    composer.profileSwingAmount = Number.isFinite(Number(composer.rhythmSwing)) ? Number(composer.rhythmSwing) : 0;

    return composer;
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
    chords: ({ progression = ['C'], direction = 'R' } = {}) => {
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
      if (typeof direction !== 'string' || direction.length === 0) throw new Error('ComposerFactory.chords: direction must be a non-empty string');
      const composer = new (ChordComposer)(p);
      if (direction.toUpperCase() !== 'R') {
        composer.noteSet(p, direction);
      }
      return composer;
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
    tensionRelease: ({ key = allNotes[ri(allNotes.length - 1)], quality = 'major', tensionCurve = 0.5, enablePhraseArcs = true, phraseArcOpts = {}, phraseTensionScaling = true } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.tensionRelease: allNotes not available');
      const phraseArcManager = enablePhraseArcs ? ComposerFactory.getPhraseArcManager(phraseArcOpts) : null;
      return new TensionReleaseComposer(key, quality, tensionCurve, { phraseArcManager, phraseTensionScaling });
    },
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.modalInterchange: allNotes not available');
      return new ModalInterchangeComposer(key, primaryMode, borrowProbability);
    },
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major', changeEmphasis = 2.0, anticipation = false, settling = true, enablePhraseArcs = true, phraseArcOpts = {}, phraseBoundaryEmphasis = 1.3 } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.harmonicRhythm: allNotes not available');
      const k = key === 'random' ? allNotes[ri(allNotes.length - 1)] : key;
      const phraseArcManager = enablePhraseArcs ? ComposerFactory.getPhraseArcManager(phraseArcOpts) : null;
      return new HarmonicRhythmComposer(progression, k, measuresPerChord, quality, { changeEmphasis, anticipation, settling, phraseArcManager, phraseBoundaryEmphasis });
    },
    melodicDevelopment: ({ name = 'major', root = 'C', intensity = 0.5, developmentBias = 0.7, enablePhraseArcs = true, phraseArcOpts = {}, inversionMode = 'diatonic', inversionPivotMode = 'first-note', inversionFixedDegree = 0, normalizeToScale = true, useDegreeNoise = true, arcScaling = true } = {}) => {
      const phraseArcManager = enablePhraseArcs ? ComposerFactory.getPhraseArcManager(phraseArcOpts) : null;
      return new MelodicDevelopmentComposer(name, root, intensity, developmentBias, { phraseArcManager, inversionMode, inversionPivotMode, inversionFixedDegree, normalizeToScale, useDegreeNoise, arcScaling });
    },
    voiceLeading: ({ name = 'major', root = 'C', commonToneWeight = 0.7, contraryMotionPreference = 0.4 } = {}) => new VoiceLeadingComposer(name, root, commonToneWeight, contraryMotionPreference),
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
    this.applyRuntimeProfileConfig(composer, config);
    return this.applyCapabilityContract(composer, type, config);
  }

  static resolveComposerPoolName(extraConfig = {}, composerCtx = null) {
    if (extraConfig !== undefined && (typeof extraConfig !== 'object' || extraConfig === null)) {
      throw new Error('ComposerFactory.resolveComposerPoolName: extraConfig must be an object if provided');
    }

    const fromConfig = extraConfig.composerPool ?? extraConfig.profilePool ?? extraConfig.composerProfilePool;
    if (fromConfig !== undefined) {
      if (typeof fromConfig !== 'string' || fromConfig.length === 0) {
        throw new Error('ComposerFactory.resolveComposerPoolName: configured pool name must be a non-empty string');
      }
      return fromConfig;
    }

    if (composerCtx && typeof composerCtx === 'object') {
      if (composerCtx.composerPool !== undefined) {
        if (typeof composerCtx.composerPool !== 'string' || composerCtx.composerPool.length === 0) {
          throw new Error('ComposerFactory.resolveComposerPoolName: composerCtx.composerPool must be a non-empty string when provided');
        }
        return composerCtx.composerPool;
      }

      if (typeof composerCtx.selectComposerPool === 'function') {
        const selected = composerCtx.selectComposerPool({
          defaultPool: 'default',
          sectionIndex: (typeof sectionIndex === 'number') ? sectionIndex : null,
          phraseIndex: (typeof phraseIndex === 'number') ? phraseIndex : null,
          measureIndex: (typeof measureIndex === 'number') ? measureIndex : null
        });
        if (selected === undefined || selected === null) return 'default';
        if (typeof selected !== 'string' || selected.length === 0) {
          throw new Error('ComposerFactory.resolveComposerPoolName: selectComposerPool() must return a non-empty string when provided');
        }
        return selected;
      }
    }

    return 'default';
  }

  static createRandom(extraConfig = {}, ctx = null) {
    // Set context if provided; fall back to shared context
    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);

    const poolName = this.resolveComposerPoolName(extraConfig, composerCtx);
    let composerPool;
    if (poolName === 'default') {
      if (typeof getDefaultComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandom: getDefaultComposerPoolOrFail() is not available');
      }
      composerPool = getDefaultComposerPoolOrFail();
    } else {
      if (typeof getComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandom: getComposerPoolOrFail() is not available');
      }
      composerPool = getComposerPoolOrFail(poolName);
    }
    if (!Array.isArray(composerPool) || composerPool.length === 0) {
      throw new Error(`ComposerFactory.createRandom: composer profile pool "${poolName}" is empty`);
    }

    // Try up to N composers from default pool; fail-fast if all attempts exhaust
    const maxAttempts = m.min(8, composerPool.length);
    let lastError = null;

    for (let i = 0; i < maxAttempts; i++) {
      const cfg = composerPool[ri(composerPool.length - 1)];
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
    throw new Error(`ComposerFactory.createRandom: failed to create valid composer after ${maxAttempts} attempts from pool "${poolName}". Last error: ${lastError && lastError.message ? lastError.message : lastError}`);
  }
}

ComposerFactory.validateCapabilityProfiles();
