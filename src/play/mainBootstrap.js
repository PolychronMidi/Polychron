// mainBootstrap.js - Bootstrap validation helpers and MAIN_LOOP_CONTROLS parsing for main.js

mainBootstrap = (() => {
  const V = validator.create('mainBootstrap');

  /** @param {string} label @param {unknown} value @returns {number} */
  function requireFiniteNumber(label, value) {
    return V.requireFinite(value, label);
  }

  /** @param {string} label @param {unknown} value @returns {number} */
  function requireUnitInterval(label, value) {
    const n = requireFiniteNumber(label, value);
    if (n < 0 || n > 1) {
      throw new Error(`mainBootstrap: ${label} must be within [0, 1], received ${n}`);
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
    const ctx = globalConductor.update();
    if (!ctx || typeof ctx !== 'object') {
      throw new Error('mainBootstrap: globalConductor.update must return an object context');
    }
    return {
      playProb: requireUnitInterval('globalConductor.update.playProb', ctx.playProb),
      stutterProb: requireUnitInterval('globalConductor.update.stutterProb', ctx.stutterProb)
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
    if (fxStereoPanDenominator <= 0) throw new Error('mainBootstrap: stereoPanDenominator must be > 0');

    const fxVelocityShiftDenominator = requireFiniteNumber('fxIntensityNormalization.velocityShiftDenominator', fxn.velocityShiftDenominator);
    if (fxVelocityShiftDenominator <= 0) throw new Error('mainBootstrap: velocityShiftDenominator must be > 0');

    const stutterPanJitterChance = requireUnitInterval('stutterPanJitterChance', MAIN_LOOP_CONTROLS.stutterPanJitterChance);

    return { phaseAffinity: pfb.phaseAffinity, phaseBiasLockProbability, fxStereoPanDenominator, fxVelocityShiftDenominator, stutterPanJitterChance };
  }

  /** Verify all required globals exist before main loop starts. */
  function assertBootstrapGlobals() {
    // -- Phase 1: Verify every name in fullBootstrap.VALIDATED_GLOBALS exists --
    // This is the ONE place typeof probes are legitimate - proving globals exist
    // so that no other file needs to. The ESLint rule exempts this file.
    const validated = fullBootstrap.getValidatedGlobalsList();
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
      throw new Error(`mainBootstrap: missing validated globals: ${missing.join(', ')}`);
    }

    // -- Phase 2: Verify eventCatalog event names --
    const events = V.getEventsOrThrow();
    const EXPECTED_EVENTS = [
      'SECTION_BOUNDARY', 'JOURNEY_MOVE', 'TEXTURE_CONTRAST', 'BEAT_FX_APPLIED',
      'STUTTER_APPLIED', 'CONDUCTOR_REGULATION', 'BEAT_BINAURAL_APPLIED',
      'HARMONIC_CHANGE', 'NOTES_EMITTED', 'MOTIF_CHAIN_APPLIED',
      'CROSS_LAYER_EXPLAIN', 'CONVERGENCE_HARMONIC_TRIGGER',
      'CROSS_LAYER_CONVERGENCE', 'CROSS_LAYER_CADENCE_ALIGN',
      'PHRASE_BOUNDARY', 'MEASURE_BOUNDARY'
    ];
    EXPECTED_EVENTS.forEach((name) => requireNonEmptyString(`eventCatalog.names.${name}`, events[name]));
    const catalogKeys = Object.keys(events);
    const MIN_EVENT_COUNT = 16;
    if (catalogKeys.length < MIN_EVENT_COUNT) {
      throw new Error(`mainBootstrap: eventCatalog has only ${catalogKeys.length} events (expected >= ${MIN_EVENT_COUNT})`);
    }
    const unlisted = catalogKeys.filter(k => !EXPECTED_EVENTS.includes(k));
    if (unlisted.length > 0) {
      throw new Error(`mainBootstrap: eventCatalog has unverified events: ${unlisted.join(', ')} - add them to EXPECTED_EVENTS in mainBootstrap.js`);
    }

    // -- Phase 3: Verify key module methods exist (shape checks beyond typeof) --
    /** @type {[string, any, string][]} */
    const requiredModules = [
      ['eventBus', eventBus, 'emit'],
      ['LayerManager', LM, 'register'],
      ['FactoryManager', FactoryManager, 'getPhraseArcManager'],
      ['conductorConfig', conductorConfig, 'applyPhaseProfile'],
      ['stutter', stutter, 'prepareBeat'],
      ['conductorState', conductorState, 'initialize'],
      ['conductorState', conductorState, 'getField'],
      ['globalConductor', globalConductor, 'update'],
      ['harmonicJourney', harmonicJourney, 'planJourney'],
      ['harmonicJourney', harmonicJourney, 'applyToContext'],
      ['harmonicJourney', harmonicJourney, 'applyL2ToContext'],
      ['sectionLengthAdvisor', sectionLengthAdvisor, 'advisePhraseCount'],
      ['pivotChordBridge', pivotChordBridge, 'prepareBridge'],
      ['phaseLockedRhythmGenerator', phaseLockedRhythmGenerator, 'initializePolyrhythmCoupling'],
      ['interactionHeatMap', interactionHeatMap, 'getDensity'],
      ['interactionHeatMap', interactionHeatMap, 'getSystemHeat'],
      ['interactionHeatMap', interactionHeatMap, 'getTrend'],
      ['interactionHeatMap', interactionHeatMap, 'flushDeferredOrphans'],
      ['rhythmicPhaseLock', rhythmicPhaseLock, 'getMode'],
      ['cadenceAdvisor', cadenceAdvisor, 'shouldCadence'],
      ['texturalMemoryAdvisor', texturalMemoryAdvisor, 'recordUsage'],
      ['convergenceHarmonicTrigger', convergenceHarmonicTrigger, 'onConvergence'],
      ['structuralFormTracker', structuralFormTracker, 'recordSection'],
      ['entropyRegulator', entropyRegulator, 'measureEntropy'],
      ['entropyRegulator', entropyRegulator, 'regulate'],
      ['crossLayerClimaxEngine', crossLayerClimaxEngine, 'getModifiers'],
      ['negotiationEngine', negotiationEngine, 'apply'],
      ['sectionIntentCurves', sectionIntentCurves, 'getIntent'],
      ['crossLayerSilhouette', crossLayerSilhouette, 'getCorrections'],
      ['dynamismEngine', dynamismEngine, 'resolve'],
      ['textureBlender', textureBlender, 'resolve']
    ];
    requiredModules.forEach(([name, obj, method]) => {
      if (!obj || typeof obj[/** @type {string} */ (method)] !== 'function') {
        throw new Error(`mainBootstrap: ${name}.${method} is not available`);
      }
    });

    // -- Phase 4: Verify initializer methods --
    /** @type {[string, any][]} */
    const requiredInitializers = [
      ['FXFeedbackListener', FXFeedbackListener],
      ['stutterFeedbackListener', stutterFeedbackListener],
      ['journeyRhythmCoupler', journeyRhythmCoupler],
      ['conductorRegulationListener', conductorRegulationListener],
      ['drumTextureCoupler', drumTextureCoupler],
      ['emissionFeedbackListener', emissionFeedbackListener],
      ['harmonicRhythmTracker', harmonicRhythmTracker],
      ['conductorState', conductorState],
      ['cadenceAdvisor', cadenceAdvisor]
    ];
    requiredInitializers.forEach(([name, obj]) => {
      if (!obj || typeof obj.initialize !== 'function') {
        throw new Error(`mainBootstrap: ${name}.initialize is not available`);
      }
    });

    // -- Phase 5: Verify beat pipeline topological ordering --
    beatPipelineDescriptor.assertTopologicalOrder();

    // -- Phase 6: moved to assertRegistryPopulation() ------------------
    // Registry counts are now verified later in the boot sequence after
    // conductorIntelligence.initialize() and cross-layer reset. The original
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
        moduleCount: conductorIntelligence.getModuleCount(),
        moduleNames: conductorIntelligence.getModuleNames(),
        counts: conductorIntelligence.getCounts()
      },
      crossLayer: {
        moduleCount: crossLayerRegistry.getCount(),
        moduleNames: crossLayerRegistry.getRegisteredNames()
      }
    };
  }


  /**
   * Verify that the two registries have a sane number of entries.
   * This is run after modules have had a chance to register themselves, so it
   * must be called manually by the caller (main.js uses it immediately after
   * conductorIntelligence.initialize()).
   *
    * The thresholds are intentionally conservative; the real goal is to catch
    * catastrophic mis-loads (e.g. entire subsystem index.js omitted) while still
    * enforcing fail-fast behavior. Any threshold violation throws immediately.
   */
  function assertRegistryPopulation() {
    const ciCounts = conductorIntelligence.getCounts();
    const ciModuleCount = conductorIntelligence.getModuleCount();
    const clModuleCount = crossLayerRegistry.getCount();

    const WARN_CI_MODULES = 30;   // roughly half the normal ~70
    const WARN_CL_MODULES = 15;   // roughly half the normal ~35

    if (ciModuleCount === 0) {
      throw new Error('mainBootstrap: conductorIntelligence has no registered modules; subsystem load failure.');
    }
    if (ciModuleCount < WARN_CI_MODULES) {
      throw new Error(`mainBootstrap: only ${ciModuleCount} conductorIntelligence modules registered (expected >= ${WARN_CI_MODULES}).`);
    }
    if (ciCounts.density === 0 || ciCounts.tension === 0) {
      throw new Error('mainBootstrap: conductorIntelligence has no density/tension biases registered.');
    }
    if (ciCounts.recorders === 0 || ciCounts.stateProviders === 0) {
      throw new Error('mainBootstrap: conductorIntelligence recorders/stateProviders appear empty.');
    }
    if (clModuleCount === 0) {
      throw new Error('mainBootstrap: crossLayerRegistry has no registered modules; subsystem load failure.');
    }
    if (clModuleCount < WARN_CL_MODULES) {
      throw new Error(`mainBootstrap: only ${clModuleCount} CrossLayer modules registered (expected >= ${WARN_CL_MODULES}).`);
    }

    assertFeedbackGraphContract();
  }

  /**
   * Validate FEEDBACK_GRAPH.json against runtime module topology.
   * This is a second immune layer beyond lint rules: it proves the declared
   * feedback topology still matches live registrations and firewall boundaries.
   */
  function assertFeedbackGraphContract() {
    const graphPath = path.join(process.cwd(), 'FEEDBACK_GRAPH.json');
    if (!fs.existsSync(graphPath)) {
      throw new Error(`mainBootstrap: missing FEEDBACK_GRAPH.json at ${graphPath}`);
    }

    let graph;
    try {
      graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    } catch (err) {
      throw new Error(`mainBootstrap: FEEDBACK_GRAPH.json parse failed: ${err && err.message ? err.message : err}`);
    }

    if (!graph || typeof graph !== 'object') {
      throw new Error('mainBootstrap: FEEDBACK_GRAPH.json must parse to an object');
    }

    const firewalls = graph.firewalls;
    if (!firewalls || typeof firewalls !== 'object' || Array.isArray(firewalls)) {
      throw new Error('mainBootstrap: FEEDBACK_GRAPH.json firewalls must be an object');
    }
    const firewallKeys = Object.keys(firewalls);
    if (firewallKeys.length === 0) {
      throw new Error('mainBootstrap: FEEDBACK_GRAPH.json firewalls cannot be empty');
    }

    const loops = graph.feedbackLoops;
    if (!Array.isArray(loops) || loops.length === 0) {
      throw new Error('mainBootstrap: FEEDBACK_GRAPH.json feedbackLoops must be a non-empty array');
    }

    const validLatencies = ['immediate', 'beat-delayed', 'phrase-delayed', 'section-delayed'];
    const moduleMethodContracts = {
      coherenceMonitor: ['getDensityBias'],
      entropyRegulator: ['regulate'],
      adaptiveTrustScores: ['getSnapshot', 'registerOutcome'],
      pipelineCouplingManager: ['densityBias', 'tensionBias', 'flickerBias'],
      profileAdaptation: ['update', 'getHints']
    };
    const moduleRefs = {
      coherenceMonitor,
      entropyRegulator,
      adaptiveTrustScores,
      pipelineCouplingManager,
      profileAdaptation
    };

    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i];
      const label = `feedbackLoops[${i}]`;
      if (!loop || typeof loop !== 'object') {
        throw new Error(`mainBootstrap: ${label} must be an object`);
      }

      const id = requireNonEmptyString(`${label}.id`, loop.id);
      const modName = requireNonEmptyString(`${label}.module`, loop.module);
      requireNonEmptyString(`${label}.sourceDomain`, loop.sourceDomain);
      requireNonEmptyString(`${label}.targetDomain`, loop.targetDomain);
      requireNonEmptyString(`${label}.mechanism`, loop.mechanism);

      const latency = requireNonEmptyString(`${label}.latency`, loop.latency);
      if (!validLatencies.includes(latency)) {
        throw new Error(`mainBootstrap: ${label}.latency must be one of ${validLatencies.join(', ')} (received "${latency}")`);
      }

      if (!Array.isArray(loop.firewallsCrossed)) {
        throw new Error(`mainBootstrap: ${label}.firewallsCrossed must be an array`);
      }
      for (let j = 0; j < loop.firewallsCrossed.length; j++) {
        const firewall = requireNonEmptyString(`${label}.firewallsCrossed[${j}]`, loop.firewallsCrossed[j]);
        if (!firewallKeys.includes(firewall)) {
          throw new Error(`mainBootstrap: ${label} references unknown firewall "${firewall}"`);
        }
      }

      const modRef = moduleRefs[modName];
      if (!modRef || typeof modRef !== 'object') {
        throw new Error(`mainBootstrap: FEEDBACK_GRAPH loop "${id}" references missing module "${modName}"`);
      }
      const methods = moduleMethodContracts[modName] || [];
      for (let j = 0; j < methods.length; j++) {
        const method = methods[j];
        if (typeof modRef[method] !== 'function') {
          throw new Error(`mainBootstrap: FEEDBACK_GRAPH loop "${id}" expects ${modName}.${method}()`);
        }
      }
    }

    // Firewall contract: cross-layer modules cannot directly register conductor
    // density/tension/flicker biases. Recorder/stateProvider bridge traffic is allowed.
    const crossLayerNames = new Set(crossLayerRegistry.getRegisteredNames());
    const ciNames = conductorIntelligence.getRegistryNames();
    const forbidden = [];

    ['density', 'tension', 'flicker'].forEach((bucket) => {
      const names = ciNames[bucket];
      for (let i = 0; i < names.length; i++) {
        if (crossLayerNames.has(names[i])) {
          forbidden.push(`${bucket}:${names[i]}`);
        }
      }
    });

    if (forbidden.length > 0) {
      throw new Error(
        'mainBootstrap: firewall breach - cross-layer modules registered conductor biases directly: ' +
        forbidden.join(', ')
      );
    }
  }

  return { requireFiniteNumber, requireUnitInterval, requireNonEmptyString, getConductorProbabilities, parseControls, assertBootstrapGlobals, getRegistryManifest, assertRegistryPopulation, assertFeedbackGraphContract };
})();
