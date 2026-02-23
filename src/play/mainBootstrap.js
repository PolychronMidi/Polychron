// mainBootstrap.js - Bootstrap validation helpers and MAIN_LOOP_CONTROLS parsing for main.js

MainBootstrap = (() => {
  const V = Validator.create('mainBootstrap');

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
   * @returns {{ playProb: number, stutterProb: number }}
   */
  function getConductorProbabilities() {
    const ctx = GlobalConductor.update();
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
    /* eslint-disable no-restricted-globals,no-restricted-syntax */
    for (const name of validated) {
      // typeof is the only safe way to check existence of a potentially undeclared identifier
      // eslint requires we use eval-free indirect access via globalThis for dynamic names
      if (typeof globalThis[name] === 'undefined') {
        missing.push(name);
      }
    }
    /* eslint-enable no-restricted-globals,no-restricted-syntax */
    if (missing.length > 0) {
      throw new Error(`MainBootstrap: missing validated globals: ${missing.join(', ')}`);
    }

    // ── Phase 2: Verify EventCatalog event names ──
    const events = V.getEventsOrThrow();
    const EXPECTED_EVENTS = [
      'SECTION_BOUNDARY', 'JOURNEY_MOVE', 'TEXTURE_CONTRAST', 'BEAT_FX_APPLIED',
      'STUTTER_APPLIED', 'CONDUCTOR_REGULATION', 'BEAT_BINAURAL_APPLIED',
      'HARMONIC_CHANGE', 'NOTES_EMITTED', 'MOTIF_CHAIN_APPLIED',
      'CROSS_LAYER_EXPLAIN', 'CONVERGENCE_HARMONIC_TRIGGER',
      'CROSS_LAYER_CONVERGENCE', 'CROSS_LAYER_CADENCE_ALIGN',
      'PHRASE_BOUNDARY', 'MEASURE_BOUNDARY'
    ];
    EXPECTED_EVENTS.forEach((name) => requireNonEmptyString(`EventCatalog.names.${name}`, events[name]));
    const catalogKeys = Object.keys(events);
    const MIN_EVENT_COUNT = 16;
    if (catalogKeys.length < MIN_EVENT_COUNT) {
      throw new Error(`MainBootstrap: EventCatalog has only ${catalogKeys.length} events (expected >= ${MIN_EVENT_COUNT})`);
    }
    const unlisted = catalogKeys.filter(k => !EXPECTED_EVENTS.includes(k));
    if (unlisted.length > 0) {
      throw new Error(`MainBootstrap: EventCatalog has unverified events: ${unlisted.join(', ')} — add them to EXPECTED_EVENTS in mainBootstrap.js`);
    }

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
      ['StructuralFormTracker', StructuralFormTracker, 'recordSection'],
      ['EntropyRegulator', EntropyRegulator, 'measureEntropy'],
      ['EntropyRegulator', EntropyRegulator, 'regulate'],
      ['CrossLayerClimaxEngine', CrossLayerClimaxEngine, 'getModifiers'],
      ['NegotiationEngine', NegotiationEngine, 'apply'],
      ['SectionIntentCurves', SectionIntentCurves, 'getIntent'],
      ['CrossLayerSilhouette', CrossLayerSilhouette, 'getCorrections'],
      ['DynamismEngine', DynamismEngine, 'resolve'],
      ['TextureBlender', TextureBlender, 'resolve']
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

    // ── Phase 5: Verify beat pipeline topological ordering ──
    BeatPipelineDescriptor.assertTopologicalOrder();

    // ── Phase 6: moved to assertRegistryPopulation() ──────────────────
    // Registry counts are now verified later in the boot sequence after
    // ConductorIntelligence.initialize() and cross‑layer reset. The original
    // checks were firing too early when modules register during initialization
    // or under minimal/test builds. See assertRegistryPopulation() below.
  }

  /**
   * Collect a registry manifest for diagnostic/introspection output.
   * Call after assertBootstrapGlobals() passes (all modules loaded and registered).
   * @returns {{ conductorIntelligence: { moduleCount: number, moduleNames: string[], counts: object }, crossLayer: { moduleCount: number, moduleNames: string[] } }}
   */
  function getRegistryManifest() {
    return {
      conductorIntelligence: {
        moduleCount: ConductorIntelligence.getModuleCount(),
        moduleNames: ConductorIntelligence.getModuleNames(),
        counts: ConductorIntelligence.getCounts()
      },
      crossLayer: {
        moduleCount: CrossLayerRegistry.getCount(),
        moduleNames: CrossLayerRegistry.getRegisteredNames()
      }
    };
  }


  /**
   * Verify that the two registries have a sane number of entries.
   * This is run after modules have had a chance to register themselves, so it
   * must be called manually by the caller (main.js uses it immediately after
   * ConductorIntelligence.initialize()).
   *
    * The thresholds are intentionally conservative; the real goal is to catch
    * catastrophic mis‑loads (e.g. entire subsystem index.js omitted) while still
    * enforcing fail-fast behavior. Any threshold violation throws immediately.
   */
  function assertRegistryPopulation() {
    const ciCounts = ConductorIntelligence.getCounts();
    const ciModuleCount = ConductorIntelligence.getModuleCount();
    const clModuleCount = CrossLayerRegistry.getCount();

    const WARN_CI_MODULES = 30;   // roughly half the normal ~70
    const WARN_CL_MODULES = 15;   // roughly half the normal ~35

    if (ciModuleCount === 0) {
      throw new Error('MainBootstrap: ConductorIntelligence has no registered modules; subsystem load failure.');
    }
    if (ciModuleCount < WARN_CI_MODULES) {
      throw new Error(`MainBootstrap: only ${ciModuleCount} ConductorIntelligence modules registered (expected >= ${WARN_CI_MODULES}).`);
    }
    if (ciCounts.density === 0 || ciCounts.tension === 0) {
      throw new Error('MainBootstrap: ConductorIntelligence has no density/tension biases registered.');
    }
    if (ciCounts.recorders === 0 || ciCounts.stateProviders === 0) {
      throw new Error('MainBootstrap: ConductorIntelligence recorders/stateProviders appear empty.');
    }
    if (clModuleCount === 0) {
      throw new Error('MainBootstrap: CrossLayerRegistry has no registered modules; subsystem load failure.');
    }
    if (clModuleCount < WARN_CL_MODULES) {
      throw new Error(`MainBootstrap: only ${clModuleCount} CrossLayer modules registered (expected >= ${WARN_CL_MODULES}).`);
    }
  }

  return { requireFiniteNumber, requireUnitInterval, requireNonEmptyString, getConductorProbabilities, parseControls, assertBootstrapGlobals, getRegistryManifest, assertRegistryPopulation };
})();
