const V = Validator.create('factoryProfiles');

factoryProfiles = {
  getCapabilityProfilesDefault() {
    return {
      measure: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: false },
      scale: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
      mode: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
      pentatonic: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
      blues: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
      chromatic: { preservesScale: false, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
      quartal: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
      voiceLeading: { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: false },
      chords: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
      harmonicRhythm: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
      tensionRelease: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
      modalInterchange: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
      melodicDevelopment: { preservesScale: true, mutatesPitchClasses: true, deterministic: false, notesReflectOutputSet: true, timeVaryingScaleContext: true },
    };
  },

  getRuntimeProfilePrecedenceDefault() {
    return { baseVelocity: ['chord', 'voice'] };
  },

  getCommonProfileConfigKeys() {
    return ['type', 'voiceProfile', 'chordProfile', 'motifProfile', 'rhythmProfile', 'resolvedProfiles'];
  },

  getConstructorOptionKeysByType() {
    const common = this.getCommonProfileConfigKeys();
    return {
      measure: [...common],
      scale: [...common, 'name', 'root'],
      chords: [...common, 'progression', 'direction'],
      mode: [...common, 'name', 'root'],
      pentatonic: [...common, 'root', 'scaleType'],
      blues: [...common, 'root', 'bluesType', 'blueNoteProb'],
      chromatic: [...common, 'targetScaleName', 'root', 'chromaticDensity'],
      quartal: [...common, 'scaleName', 'root', 'voicingType', 'stackSize'],
      tensionRelease: [...common, 'key', 'quality', 'tensionCurve', 'enablePhraseArcs', 'phraseArcOpts', 'phraseTensionScaling'],
      modalInterchange: [...common, 'key', 'primaryMode', 'borrowProbability'],
      melodicDevelopment: [...common, 'name', 'root', 'intensity', 'developmentBias', 'enablePhraseArcs', 'phraseArcOpts', 'inversionMode', 'inversionPivotMode', 'inversionFixedDegree', 'normalizeToScale', 'useDegreeNoise', 'arcScaling'],
      voiceLeading: [...common, 'name', 'root', 'commonToneWeight', 'contraryMotionPreference'],
      harmonicRhythm: [...common, 'progression', 'key', 'measuresPerChord', 'quality', 'changeEmphasis', 'anticipation', 'settling', 'enablePhraseArcs', 'phraseArcOpts', 'phraseBoundaryEmphasis']
    };
  },

  validateCapabilityProfiles(capabilityProfiles) {
    if (!capabilityProfiles || typeof capabilityProfiles !== 'object') {
      throw new Error('factoryProfiles.validateCapabilityProfiles: capabilityProfiles must be an object');
    }
    const entries = Object.entries(capabilityProfiles);
    const normalized = {};
    for (const [type, profile] of entries) {
      try {
        normalized[type] = assertComposerCapabilities(profile);
      } catch (e) {
        throw new Error(`factoryProfiles.validateCapabilityProfiles: invalid profile for type "${type}": ${e && e.message ? e.message : e}`);
      }
    }
    return normalized;
  },

  validateProfileSchemaFactoryCompatibility(getConstructorOptionKeysByType) {
    if (typeof getConstructorOptionKeysByType !== 'function') {
      throw new Error('factoryProfiles.validateProfileSchemaFactoryCompatibility: getConstructorOptionKeysByType must be a function');
    }
    V.assertManagerShape(ComposerProfileValidation, 'ComposerProfileValidation', ['getAllowedKeysByTypeOrFail']);

    const schemaKeysByType = ComposerProfileValidation.getAllowedKeysByTypeOrFail();
    if (!schemaKeysByType || typeof schemaKeysByType !== 'object') {
      throw new Error('factoryProfiles.validateProfileSchemaFactoryCompatibility: schema key map is invalid');
    }

    const factoryKeysByType = getConstructorOptionKeysByType();
    for (const [type, schemaKeys] of Object.entries(schemaKeysByType)) {
      const schemaSet = new Set(Array.isArray(schemaKeys) ? schemaKeys : []);
      const factorySet = new Set(Array.isArray(factoryKeysByType[type]) ? factoryKeysByType[type] : []);
      if (factorySet.size === 0) {
        throw new Error(`factoryProfiles.validateProfileSchemaFactoryCompatibility: missing factory config key map for type "${type}"`);
      }

      for (const key of schemaSet) {
        if (!factorySet.has(key)) {
          throw new Error(`factoryProfiles.validateProfileSchemaFactoryCompatibility: schema key "${type}.${key}" is not handled by ComposerFactory`);
        }
      }
      for (const key of factorySet) {
        if (!schemaSet.has(key)) {
          throw new Error(`factoryProfiles.validateProfileSchemaFactoryCompatibility: factory key "${type}.${key}" is missing from profile schema`);
        }
      }
    }

    return true;
  },

  resolveRuntimeProfiles(config = {}) {
    if (config !== undefined && (typeof config !== 'object' || config === null)) {
      throw new Error('factoryProfiles.resolveRuntimeProfiles: config must be an object');
    }
    V.assertManagerShape(ComposerRuntimeProfileAdapter, 'ComposerRuntimeProfileAdapter', ['resolveRuntimeProfilesOrFail']);
    return ComposerRuntimeProfileAdapter.resolveRuntimeProfilesOrFail(config, 'ComposerFactory.resolveRuntimeProfiles');
  },

  applyRuntimeProfileConfig(composer, config = {}, runtimeProfilePrecedence = {}) {
    if (!composer) {
      throw new Error('factoryProfiles.applyRuntimeProfileConfig: composer must be an object');
    }
    const runtimeProfiles = this.resolveRuntimeProfiles(config);
    if (Object.keys(runtimeProfiles).length === 0) return composer;

    V.assertManagerShape(ComposerRuntimeProfileAdapter, 'ComposerRuntimeProfileAdapter', ['buildNormalizedRuntimeProfileOrFail', 'applyToComposerOrFail']);

    const runtimeProfile = ComposerRuntimeProfileAdapter.buildNormalizedRuntimeProfileOrFail(runtimeProfiles, {
      baseVelocityPrecedence: runtimeProfilePrecedence.baseVelocity
    });
    return ComposerRuntimeProfileAdapter.applyToComposerOrFail(composer, runtimeProfile);
  },

  applyCapabilityContract(composer, type, config = {}, capabilityProfiles = {}) {
    if (!composer) {
      throw new Error('factoryProfiles.applyCapabilityContract: composer must be an object');
    }
    const defaultProfile = { preservesScale: true, mutatesPitchClasses: false, deterministic: false, notesReflectOutputSet: false, timeVaryingScaleContext: false };
    const profile = capabilityProfiles[type] || defaultProfile;
    const fromComposer = (typeof composer.getCapabilities === 'function')
      ? composer.getCapabilities()
      : (composer.capabilities && typeof composer.capabilities === 'object' ? composer.capabilities : {});
    const fromConfig = (config && typeof config.capabilities === 'object' && config.capabilities !== null) ? config.capabilities : {};
    const merged = Object.assign({}, profile, fromComposer, fromConfig);

    const validated = assertComposerCapabilities(merged);
    if (typeof composer.setCapabilities === 'function') {
      composer.setCapabilities(validated);
    } else {
      composer.capabilities = validated;
    }
    return composer;
  }
};
