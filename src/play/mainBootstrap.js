// mainBootstrap.js - Bootstrap validation helpers and MAIN_LOOP_CONTROLS parsing for main.js

MainBootstrap = (() => {
  const V = Validator.create('MainBootstrap');

  /** @param {string} label @param {unknown} value @returns {number} */
  function requireFiniteNumber(label, value) {
    return V.requireFinite(value, label);
  }

  /** @param {string} label @param {unknown} value @returns {number} */
  function requireUnitInterval(label, value) {
    const n = requireFiniteNumber(label, value);
    if (n < 0 || n > 1) {
      throw new Error(`MainBootstrap: ${label} must be within [0, 1], received ${n}`);
    }
    return n;
  }

  /** @param {string} label @param {unknown} value @returns {string} */
  function requireNonEmptyString(label, value) {
    return V.assertNonEmptyString(value, label);
  }

  /**
   * @param {number} measureIndexLocal
   * @param {number} beatIndexLocal
   * @returns {{ playProb: number, stutterProb: number }}
   */
  function getConductorProbabilities(measureIndexLocal, beatIndexLocal) {
    const ctx = GlobalConductor.update(measureIndexLocal, beatIndexLocal);
    if (!ctx || typeof ctx !== 'object') {
      throw new Error('MainBootstrap: GlobalConductor.update must return an object context');
    }
    return {
      playProb: requireUnitInterval('GlobalConductor.update.playProb', ctx.playProb),
      stutterProb: requireUnitInterval('GlobalConductor.update.stutterProb', ctx.stutterProb)
    };
  }

  /**
   * Parse and validate MAIN_LOOP_CONTROLS.
   * @returns {{ phaseAffinity: Object, phaseBiasLockProbability: number, fxStereoPanDenominator: number, fxVelocityShiftDenominator: number, stutterPanJitterChance: number }}
   */
  function parseControls() {
    V.assertPlainObject(MAIN_LOOP_CONTROLS, 'MAIN_LOOP_CONTROLS');

    const pfb = MAIN_LOOP_CONTROLS.phraseFamilyBias;
    V.assertPlainObject(pfb, 'MAIN_LOOP_CONTROLS.phraseFamilyBias');
    V.assertPlainObject(pfb.phaseAffinity, 'MAIN_LOOP_CONTROLS.phraseFamilyBias.phaseAffinity');
    const phaseBiasLockProbability = requireUnitInterval('phraseFamilyBias.lockProbability', pfb.lockProbability);

    const fxn = MAIN_LOOP_CONTROLS.fxIntensityNormalization;
    V.assertPlainObject(fxn, 'MAIN_LOOP_CONTROLS.fxIntensityNormalization');

    const fxStereoPanDenominator = requireFiniteNumber('fxIntensityNormalization.stereoPanDenominator', fxn.stereoPanDenominator);
    if (fxStereoPanDenominator <= 0) throw new Error('MainBootstrap: stereoPanDenominator must be > 0');

    const fxVelocityShiftDenominator = requireFiniteNumber('fxIntensityNormalization.velocityShiftDenominator', fxn.velocityShiftDenominator);
    if (fxVelocityShiftDenominator <= 0) throw new Error('MainBootstrap: velocityShiftDenominator must be > 0');

    const stutterPanJitterChance = requireUnitInterval('stutterPanJitterChance', MAIN_LOOP_CONTROLS.stutterPanJitterChance);

    return { phaseAffinity: pfb.phaseAffinity, phaseBiasLockProbability, fxStereoPanDenominator, fxVelocityShiftDenominator, stutterPanJitterChance };
  }

  /** Verify all required globals exist before main loop starts. */
  function assertBootstrapGlobals() {
    // ── Phase 1: Verify every name in FullBootstrap.VALIDATED_GLOBALS exists ──
    // This is the ONE place typeof probes are legitimate — proving globals exist
    // so that no other file needs to. The ESLint rule exempts this file.
    const validated = FullBootstrap.getValidatedGlobalsList();
    const missing = [];
    for (const name of validated) {
      // typeof is the only safe way to check existence of a potentially undeclared identifier
      // eslint requires we use eval-free indirect access via globalThis for dynamic names
      if (typeof globalThis[name] === 'undefined') {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      throw new Error(`MainBootstrap: missing validated globals: ${missing.join(', ')}`);
    }

    // ── Phase 2: Verify EventCatalog event names ──
    const events = V.getEventsOrThrow();
    ['SECTION_BOUNDARY', 'JOURNEY_MOVE', 'TEXTURE_CONTRAST', 'BEAT_FX_APPLIED',
      'STUTTER_APPLIED', 'CONDUCTOR_REGULATION', 'BEAT_BINAURAL_APPLIED',
      'HARMONIC_CHANGE', 'NOTES_EMITTED', 'MOTIF_CHAIN_APPLIED'
    ].forEach((name) => requireNonEmptyString(`EventCatalog.names.${name}`, events[name]));

    // ── Phase 3: Verify key module methods exist (shape checks beyond typeof) ──
    /** @type {[string, any, string][]} */
    const requiredModules = [
      ['EventBus', EventBus, 'emit'],
      ['LayerManager', LM, 'register'],
      ['ComposerFactory', ComposerFactory, 'getPhraseArcManager'],
      ['ConductorConfig', ConductorConfig, 'applyPhaseProfile'],
      ['Stutter', Stutter, 'prepareBeat'],
      ['ConductorState', ConductorState, 'initialize'],
      ['ConductorState', ConductorState, 'getField'],
      ['GlobalConductor', GlobalConductor, 'update'],
      ['HarmonicJourney', HarmonicJourney, 'planJourney'],
      ['HarmonicJourney', HarmonicJourney, 'applyToContext'],
      ['HarmonicJourney', HarmonicJourney, 'applyL2ToContext'],
      ['SectionLengthAdvisor', SectionLengthAdvisor, 'advisePhraseCount'],
      ['PivotChordBridge', PivotChordBridge, 'prepareBridge'],
      ['PhaseLockedRhythmGenerator', PhaseLockedRhythmGenerator, 'initializePolyrhythmCoupling'],
      ['InteractionHeatMap', InteractionHeatMap, 'getDensity'],
      ['InteractionHeatMap', InteractionHeatMap, 'getSystemHeat'],
      ['InteractionHeatMap', InteractionHeatMap, 'getTrend'],
      ['InteractionHeatMap', InteractionHeatMap, 'flushDeferredOrphans'],
      ['RhythmicPhaseLock', RhythmicPhaseLock, 'getMode'],
      ['CadenceAdvisor', CadenceAdvisor, 'shouldCadence'],
      ['TexturalMemoryAdvisor', TexturalMemoryAdvisor, 'recordUsage'],
      ['ConvergenceHarmonicTrigger', ConvergenceHarmonicTrigger, 'onConvergence'],
      ['StructuralFormTracker', StructuralFormTracker, 'recordSection']
    ];
    requiredModules.forEach(([name, obj, method]) => {
      if (!obj || typeof obj[/** @type {string} */ (method)] !== 'function') {
        throw new Error(`MainBootstrap: ${name}.${method} is not available`);
      }
    });

    // ── Phase 4: Verify initializer methods ──
    /** @type {[string, any][]} */
    const requiredInitializers = [
      ['FXFeedbackListener', FXFeedbackListener],
      ['StutterFeedbackListener', StutterFeedbackListener],
      ['JourneyRhythmCoupler', JourneyRhythmCoupler],
      ['ConductorRegulationListener', ConductorRegulationListener],
      ['DrumTextureCoupler', DrumTextureCoupler],
      ['EmissionFeedbackListener', EmissionFeedbackListener],
      ['HarmonicRhythmTracker', HarmonicRhythmTracker],
      ['ConductorState', ConductorState],
      ['CadenceAdvisor', CadenceAdvisor]
    ];
    requiredInitializers.forEach(([name, obj]) => {
      if (!obj || typeof obj.initialize !== 'function') {
        throw new Error(`MainBootstrap: ${name}.initialize is not available`);
      }
    });
  }

  return { requireFiniteNumber, requireUnitInterval, requireNonEmptyString, getConductorProbabilities, parseControls, assertBootstrapGlobals };
})();
