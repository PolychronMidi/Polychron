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

  static getCommonProfileConfigKeys() {
    return ['type', 'voiceProfile', 'chordProfile', 'motifProfile', 'rhythmProfile', 'resolvedProfiles'];
  }

  static getConstructorOptionKeysByType() {
    const common = this.getCommonProfileConfigKeys();
    return {
      measure: [...common],
      scale: [...common, 'name', 'root'],
      chords: [...common, 'progression', 'direction'],
      mode: [...common, 'name', 'root'],
      pentatonic: [...common, 'root', 'scaleType'],
      tensionRelease: [...common, 'key', 'quality', 'tensionCurve', 'enablePhraseArcs', 'phraseArcOpts', 'phraseTensionScaling'],
      modalInterchange: [...common, 'key', 'primaryMode', 'borrowProbability'],
      melodicDevelopment: [...common, 'name', 'root', 'intensity', 'developmentBias', 'enablePhraseArcs', 'phraseArcOpts', 'inversionMode', 'inversionPivotMode', 'inversionFixedDegree', 'normalizeToScale', 'useDegreeNoise', 'arcScaling'],
      voiceLeading: [...common, 'name', 'root', 'commonToneWeight', 'contraryMotionPreference'],
      harmonicRhythm: [...common, 'progression', 'key', 'measuresPerChord', 'quality', 'changeEmphasis', 'anticipation', 'settling', 'enablePhraseArcs', 'phraseArcOpts', 'phraseBoundaryEmphasis']
    };
  }

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

  static normalizeProgressionKeyOrFail(key, label = 'ComposerFactory.normalizeProgressionKeyOrFail') {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`${label}: key must be a non-empty string`);
    }
    if (typeof t === 'undefined' || !t || !t.Note || typeof t.Note.pitchClass !== 'function') {
      throw new Error(`${label}: tonal Note.pitchClass() not available`);
    }
    const pc = t.Note.pitchClass(key);
    if (typeof pc !== 'string' || pc.length === 0) {
      throw new Error(`${label}: could not normalize key "${key}" to pitch class`);
    }
    return pc;
  }

  static getRomanQualityOrFail(quality, label = 'ComposerFactory.getRomanQualityOrFail') {
    if (typeof quality !== 'string' || quality.length === 0) {
      throw new Error(`${label}: quality must be a non-empty string`);
    }
    const modeToQuality = {
      ionian: 'major', dorian: 'minor', phrygian: 'minor', lydian: 'major',
      mixolydian: 'major', aeolian: 'minor', locrian: 'minor', major: 'major', minor: 'minor'
    };
    const normalized = quality.toLowerCase();
    const romanQuality = modeToQuality[normalized];
    if (!romanQuality) {
      throw new Error(`${label}: unknown quality or mode "${quality}"`);
    }
    return romanQuality;
  }

  static hasDiatonicKeyData(key, quality = 'major') {
    const romanQuality = this.getRomanQualityOrFail(quality, 'ComposerFactory.hasDiatonicKeyData');
    const keyApi = romanQuality === 'minor' ? t.Key.minorKey : t.Key.majorKey;
    const keyData = keyApi(key);
    const scale = romanQuality === 'minor' ? keyData?.natural?.scale : keyData?.scale;
    const chords = romanQuality === 'minor' ? keyData?.natural?.chords : keyData?.chords;
    return Array.isArray(scale) && scale.length >= 7 && Array.isArray(chords) && chords.length >= 7;
  }

  static getProgressionKeyPoolOrFail(quality = 'major') {
    if (!Array.isArray(allNotes) || allNotes.length === 0) {
      throw new Error('ComposerFactory.getProgressionKeyPoolOrFail: allNotes not available');
    }
    this.getRomanQualityOrFail(quality, 'ComposerFactory.getProgressionKeyPoolOrFail');
    const pcs = [];
    for (const candidate of allNotes) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue;
      const pc = (typeof t !== 'undefined' && t && t.Note && typeof t.Note.pitchClass === 'function')
        ? t.Note.pitchClass(candidate)
        : null;
      if (typeof pc === 'string' && pc.length > 0 && this.hasDiatonicKeyData(pc, quality) && !pcs.includes(pc)) {
        pcs.push(pc);
      }
    }
    if (pcs.length === 0) {
      throw new Error(`ComposerFactory.getProgressionKeyPoolOrFail: no valid pitch-class keys derived from allNotes for quality "${quality}"`);
    }
    return pcs;
  }

  static resolveProgressionKeyOrFail(key, label = 'ComposerFactory.resolveProgressionKeyOrFail', quality = 'major') {
    this.getRomanQualityOrFail(quality, `${label}.quality`);
    let input = key;
    if (key === 'random') {
      const keyPool = this.getProgressionKeyPoolOrFail(quality);
      input = keyPool[ri(keyPool.length - 1)];
    }
    const normalized = this.normalizeProgressionKeyOrFail(input, label);
    if (!this.hasDiatonicKeyData(normalized, quality)) {
      throw new Error(`${label}: key "${normalized}" does not provide full diatonic data for quality "${quality}"`);
    }
    return normalized;
  }

  static validateProfileSchemaFactoryCompatibility() {
    if (typeof ComposerProfileValidation === 'undefined' || !ComposerProfileValidation || typeof ComposerProfileValidation.getAllowedKeysByTypeOrFail !== 'function') {
      throw new Error('ComposerFactory.validateProfileSchemaFactoryCompatibility: ComposerProfileValidation.getAllowedKeysByTypeOrFail() not available');
    }

    const schemaKeysByType = ComposerProfileValidation.getAllowedKeysByTypeOrFail();
    if (!schemaKeysByType || typeof schemaKeysByType !== 'object') {
      throw new Error('ComposerFactory.validateProfileSchemaFactoryCompatibility: schema key map is invalid');
    }

    const factoryKeysByType = this.getConstructorOptionKeysByType();
    for (const [type, schemaKeys] of Object.entries(schemaKeysByType)) {
      const schemaSet = new Set(Array.isArray(schemaKeys) ? schemaKeys : []);
      const factorySet = new Set(Array.isArray(factoryKeysByType[type]) ? factoryKeysByType[type] : []);

      if (factorySet.size === 0) {
        throw new Error(`ComposerFactory.validateProfileSchemaFactoryCompatibility: missing factory config key map for type "${type}"`);
      }

      for (const key of schemaSet) {
        if (!factorySet.has(key)) {
          throw new Error(`ComposerFactory.validateProfileSchemaFactoryCompatibility: schema key "${type}.${key}" is not handled by ComposerFactory`);
        }
      }

      for (const key of factorySet) {
        if (!schemaSet.has(key)) {
          throw new Error(`ComposerFactory.validateProfileSchemaFactoryCompatibility: factory key "${type}.${key}" is missing from profile schema`);
        }
      }
    }

    return true;
  }

  static resolveRuntimeProfiles(config = {}) {
    if (config !== undefined && (typeof config !== 'object' || config === null)) {
      throw new Error('ComposerFactory.resolveRuntimeProfiles: config must be an object');
    }

    if (typeof ComposerRuntimeProfileAdapter === 'undefined' || !ComposerRuntimeProfileAdapter || typeof ComposerRuntimeProfileAdapter.resolveRuntimeProfilesOrFail !== 'function') {
      throw new Error('ComposerFactory.resolveRuntimeProfiles: ComposerRuntimeProfileAdapter.resolveRuntimeProfilesOrFail() not available');
    }

    return ComposerRuntimeProfileAdapter.resolveRuntimeProfilesOrFail(config, 'ComposerFactory.resolveRuntimeProfiles');
  }

  static applyRuntimeProfileConfig(composer, config = {}) {
    if (!composer || typeof composer !== 'object') throw new Error('ComposerFactory.applyRuntimeProfileConfig: composer must be an object');
    const runtimeProfiles = this.resolveRuntimeProfiles(config);
    if (Object.keys(runtimeProfiles).length === 0) return composer;

    if (typeof ComposerRuntimeProfileAdapter === 'undefined' || !ComposerRuntimeProfileAdapter || typeof ComposerRuntimeProfileAdapter.buildNormalizedRuntimeProfileOrFail !== 'function' || typeof ComposerRuntimeProfileAdapter.applyToComposerOrFail !== 'function') {
      throw new Error('ComposerFactory.applyRuntimeProfileConfig: ComposerRuntimeProfileAdapter is unavailable');
    }

    const runtimeProfile = ComposerRuntimeProfileAdapter.buildNormalizedRuntimeProfileOrFail(runtimeProfiles, {
      baseVelocityPrecedence: this.runtimeProfilePrecedence.baseVelocity
    });
    return ComposerRuntimeProfileAdapter.applyToComposerOrFail(composer, runtimeProfile);
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
      const k = this.resolveProgressionKeyOrFail(key, 'ComposerFactory.tensionRelease', quality);
      const phraseArcManager = enablePhraseArcs ? ComposerFactory.getPhraseArcManager(phraseArcOpts) : null;
      return new TensionReleaseComposer(k, quality, tensionCurve, { phraseArcManager, phraseTensionScaling });
    },
    modalInterchange: ({ key = allNotes[ri(allNotes.length - 1)], primaryMode = 'major', borrowProbability = 0.25 } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.modalInterchange: allNotes not available');
      const k = this.resolveProgressionKeyOrFail(key, 'ComposerFactory.modalInterchange', primaryMode);
      return new ModalInterchangeComposer(k, primaryMode, borrowProbability);
    },
    harmonicRhythm: ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major', changeEmphasis = 2.0, anticipation = false, settling = true, enablePhraseArcs = true, phraseArcOpts = {}, phraseBoundaryEmphasis = 1.3 } = {}) => {
      if (!Array.isArray(allNotes) || allNotes.length === 0) throw new Error('ComposerFactory.harmonicRhythm: allNotes not available');
      const k = this.resolveProgressionKeyOrFail(key, 'ComposerFactory.harmonicRhythm', quality);
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

    const requestedPoolName = extraConfig.composerPool ?? extraConfig.profilePool ?? extraConfig.composerProfilePool;

    const context = Object.assign({}, (composerCtx && typeof composerCtx === 'object') ? composerCtx : {});
    if (!Object.prototype.hasOwnProperty.call(context, 'sectionIndex')) {
      context.sectionIndex = (typeof sectionIndex === 'number') ? sectionIndex : null;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'phraseIndex')) {
      context.phraseIndex = (typeof phraseIndex === 'number') ? phraseIndex : null;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'measureIndex')) {
      context.measureIndex = (typeof measureIndex === 'number') ? measureIndex : null;
    }

    if (typeof selectComposerPoolOrFail === 'function') {
      return selectComposerPoolOrFail({ requestedPoolName, context });
    }

    if (requestedPoolName !== undefined && requestedPoolName !== null) {
      if (typeof requestedPoolName !== 'string' || requestedPoolName.length === 0) {
        throw new Error('ComposerFactory.resolveComposerPoolName: configured pool name must be a non-empty string');
      }
      return requestedPoolName;
    }
    return 'default';
  }

  static getComposerFamiliesOrFail() {
    const fallback = {
      default: {
        weight: 1,
        types: Object.keys(this.constructors)
      }
    };
    const source = (typeof COMPOSER_FAMILIES !== 'undefined' && COMPOSER_FAMILIES && typeof COMPOSER_FAMILIES === 'object')
      ? COMPOSER_FAMILIES
      : fallback;

    const validTypes = new Set(Object.keys(this.constructors));
    const normalized = {};
    const familyNames = Object.keys(source);
    if (familyNames.length === 0) {
      throw new Error('ComposerFactory.getComposerFamiliesOrFail: no composer families configured');
    }

    for (const familyName of familyNames) {
      const family = source[familyName];
      if (!family || typeof family !== 'object') {
        throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" must be an object`);
      }
      const types = Array.isArray(family.types) ? family.types : null;
      if (!types || types.length === 0) {
        throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" must define a non-empty types array`);
      }
      const normalizedTypes = [];
      for (const type of types) {
        if (typeof type !== 'string' || type.length === 0) {
          throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" has invalid type entry`);
        }
        if (!validTypes.has(type)) {
          throw new Error(`ComposerFactory.getComposerFamiliesOrFail: family "${familyName}" references unknown composer type "${type}"`);
        }
        if (!normalizedTypes.includes(type)) normalizedTypes.push(type);
      }
      const weight = Number(family.weight);
      normalized[familyName] = {
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
        types: normalizedTypes
      };
    }

    return normalized;
  }

  static resolvePhraseFamilyOrFail(extraConfig = {}, composerCtx = null) {
    if (extraConfig !== undefined && (typeof extraConfig !== 'object' || extraConfig === null)) {
      throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: extraConfig must be an object');
    }
    if (composerCtx !== null && composerCtx !== undefined && (typeof composerCtx !== 'object' || composerCtx === null)) {
      throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: composerCtx must be an object when provided');
    }
    const families = this.getComposerFamiliesOrFail();
    const context = (composerCtx && typeof composerCtx === 'object')
      ? composerCtx
      : ((this.sharedComposerCtx && typeof this.sharedComposerCtx === 'object') ? this.sharedComposerCtx : null);

    let requestedFamily = extraConfig.phraseFamily ?? extraConfig.composerFamily;
    if ((requestedFamily === undefined || requestedFamily === null) && context && typeof context.phraseFamily === 'string') {
      requestedFamily = context.phraseFamily;
    }

    if ((requestedFamily === undefined || requestedFamily === null) && context && typeof context.selectPhraseFamily === 'function') {
      const selected = context.selectPhraseFamily({
        availableFamilies: Object.keys(families),
        sectionIndex: (typeof sectionIndex === 'number') ? sectionIndex : null,
        phraseIndex: (typeof phraseIndex === 'number') ? phraseIndex : null,
        measureIndex: (typeof measureIndex === 'number') ? measureIndex : null
      });
      if (selected !== undefined && selected !== null) {
        requestedFamily = selected;
      }
    }

    if (requestedFamily !== undefined && requestedFamily !== null) {
      if (typeof requestedFamily !== 'string' || requestedFamily.length === 0) {
        throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: requested family must be a non-empty string');
      }
      if (!Object.prototype.hasOwnProperty.call(families, requestedFamily)) {
        throw new Error(`ComposerFactory.resolvePhraseFamilyOrFail: unknown family "${requestedFamily}"`);
      }
      return requestedFamily;
    }

    const familyNames = Object.keys(families);
    let totalWeight = 0;
    for (const familyName of familyNames) {
      totalWeight += Number(families[familyName].weight);
    }
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new Error('ComposerFactory.resolvePhraseFamilyOrFail: family weights must sum to a positive finite number');
    }

    let roll = rf() * totalWeight;
    for (const familyName of familyNames) {
      roll -= Number(families[familyName].weight);
      if (roll <= 0) return familyName;
    }
    return familyNames[familyNames.length - 1];
  }

  static inferComposerType(composerInstance) {
    if (!composerInstance || typeof composerInstance !== 'object') return null;
    if (typeof composerInstance._factoryType === 'string' && composerInstance._factoryType.length > 0) {
      return composerInstance._factoryType;
    }
    const ctorName = composerInstance.constructor && composerInstance.constructor.name;
    const byCtorName = {
      MeasureComposer: 'measure',
      ScaleComposer: 'scale',
      ChordComposer: 'chords',
      ModeComposer: 'mode',
      PentatonicComposer: 'pentatonic',
      TensionReleaseComposer: 'tensionRelease',
      ModalInterchangeComposer: 'modalInterchange',
      MelodicDevelopmentComposer: 'melodicDevelopment',
      VoiceLeadingComposer: 'voiceLeading',
      HarmonicRhythmComposer: 'harmonicRhythm'
    };
    return (typeof ctorName === 'string' && byCtorName[ctorName]) ? byCtorName[ctorName] : null;
  }

  static scoreFamilyCandidateConfig(candidateConfig, opts = {}) {
    if (!candidateConfig || typeof candidateConfig !== 'object') {
      throw new Error('ComposerFactory.scoreFamilyCandidateConfig: candidateConfig must be an object');
    }
    if (typeof candidateConfig.type !== 'string' || candidateConfig.type.length === 0) {
      throw new Error('ComposerFactory.scoreFamilyCandidateConfig: candidateConfig.type must be a non-empty string');
    }

    const previousType = this.inferComposerType(opts.previousComposer);
    const peerType = this.inferComposerType(opts.peerComposer);

    let score = 1;
    if (previousType && candidateConfig.type === previousType) score += 0.45;
    if (peerType && candidateConfig.type === peerType) score -= 0.35;
    if (previousType && peerType && previousType !== peerType && candidateConfig.type !== peerType) score += 0.1;

    if (!Number.isFinite(score)) {
      throw new Error('ComposerFactory.scoreFamilyCandidateConfig: computed score is not finite');
    }
    return m.max(0.05, score);
  }

  static pickWeightedFamilyCandidateOrFail(candidateConfigs, opts = {}) {
    if (!Array.isArray(candidateConfigs) || candidateConfigs.length === 0) {
      throw new Error('ComposerFactory.pickWeightedFamilyCandidateOrFail: candidateConfigs must be a non-empty array');
    }

    const weights = candidateConfigs.map((cfg) => this.scoreFamilyCandidateConfig(cfg, opts));
    let total = 0;
    for (const w of weights) total += Number(w);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error('ComposerFactory.pickWeightedFamilyCandidateOrFail: candidate weights sum to non-positive value');
    }

    let roll = rf() * total;
    for (let i = 0; i < candidateConfigs.length; i++) {
      roll -= Number(weights[i]);
      if (roll <= 0) return candidateConfigs[i];
    }
    return candidateConfigs[candidateConfigs.length - 1];
  }

  static createRandomForLayer(opts = {}, ctx = null) {
    if (opts !== undefined && (typeof opts !== 'object' || opts === null)) {
      throw new Error('ComposerFactory.createRandomForLayer: opts must be an object');
    }

    const familyName = opts.familyName;
    if (typeof familyName !== 'string' || familyName.length === 0) {
      throw new Error('ComposerFactory.createRandomForLayer: familyName must be a non-empty string');
    }

    const layerName = opts.layerName;
    if (typeof layerName !== 'string' || layerName.length === 0) {
      throw new Error('ComposerFactory.createRandomForLayer: layerName must be a non-empty string');
    }

    const extraConfig = (opts.extraConfig && typeof opts.extraConfig === 'object') ? opts.extraConfig : {};
    const composerCtx = ctx || this.sharedComposerCtx;
    if (composerCtx) this.setComposerContext(composerCtx);

    const families = this.getComposerFamiliesOrFail();
    const family = families[familyName];
    if (!family) {
      throw new Error(`ComposerFactory.createRandomForLayer: unknown family "${familyName}"`);
    }
    const allowedTypes = new Set(family.types);

    const poolName = this.resolveComposerPoolName(extraConfig, composerCtx);
    let composerPool;
    if (poolName === 'default') {
      if (typeof getDefaultComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandomForLayer: getDefaultComposerPoolOrFail() is not available');
      }
      composerPool = getDefaultComposerPoolOrFail();
    } else {
      if (typeof getComposerPoolOrFail !== 'function') {
        throw new Error('ComposerFactory.createRandomForLayer: getComposerPoolOrFail() is not available');
      }
      composerPool = getComposerPoolOrFail(poolName);
    }

    const familyPool = composerPool.filter((cfg) => cfg && typeof cfg.type === 'string' && allowedTypes.has(cfg.type));
    if (familyPool.length === 0) {
      throw new Error(`ComposerFactory.createRandomForLayer: no composer profiles in pool "${poolName}" for family "${familyName}"`);
    }

    const maxAttempts = m.min(12, familyPool.length * 2);
    let lastError = null;

    for (let i = 0; i < maxAttempts; i++) {
      const cfg = this.pickWeightedFamilyCandidateOrFail(familyPool, {
        previousComposer: opts.previousComposer,
        peerComposer: opts.peerComposer,
        layerName
      });

      try {
        const composer = this.create(Object.assign({}, cfg, extraConfig), composerCtx);
        if (typeof composer.getNotes !== 'function') {
          throw new Error('created composer missing getNotes() method');
        }
        const notes = composer.getNotes();
        if (!Array.isArray(notes) || notes.length === 0) {
          throw new Error('composer.getNotes() returned empty or invalid array');
        }

        composer._factoryType = cfg.type;
        composer._profileFamily = familyName;
        composer._profilePool = poolName;
        composer._layerTarget = layerName;
        return composer;
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error(`ComposerFactory.createRandomForLayer: failed for layer "${layerName}" in family "${familyName}" after ${maxAttempts} attempts. Last error: ${lastError && lastError.message ? lastError.message : lastError}`);
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
ComposerFactory.validateProfileSchemaFactoryCompatibility();
