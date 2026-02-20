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
    const events = V.getEventsOrThrow();

    ['SECTION_BOUNDARY', 'JOURNEY_MOVE', 'TEXTURE_CONTRAST', 'BEAT_FX_APPLIED',
      'STUTTER_APPLIED', 'CONDUCTOR_REGULATION', 'BEAT_BINAURAL_APPLIED',
      'HARMONIC_CHANGE', 'NOTES_EMITTED', 'MOTIF_CHAIN_APPLIED'
    ].forEach((name) => requireNonEmptyString(`EventCatalog.names.${name}`, events[name]));

    /** @type {[string, any, string][]} */
    const requiredModules = [
      ['EventBus', (typeof EventBus !== 'undefined') ? EventBus : null, 'emit'],
      ['LayerManager', (typeof LM !== 'undefined') ? LM : null, 'register'],
      ['ComposerFactory', (typeof ComposerFactory !== 'undefined') ? ComposerFactory : null, 'getPhraseArcManager'],
      ['ConductorConfig', (typeof ConductorConfig !== 'undefined') ? ConductorConfig : null, 'applyPhaseProfile'],
      ['Stutter', (typeof Stutter !== 'undefined') ? Stutter : null, 'prepareBeat'],
      ['ConductorState', (typeof ConductorState !== 'undefined') ? ConductorState : null, 'initialize'],
      ['ConductorState', (typeof ConductorState !== 'undefined') ? ConductorState : null, 'getField'],
      ['GlobalConductor', (typeof GlobalConductor !== 'undefined') ? GlobalConductor : null, 'update'],
      ['HarmonicJourney', (typeof HarmonicJourney !== 'undefined') ? HarmonicJourney : null, 'planJourney'],
      ['HarmonicJourney', (typeof HarmonicJourney !== 'undefined') ? HarmonicJourney : null, 'applyToContext'],
      ['HarmonicJourney', (typeof HarmonicJourney !== 'undefined') ? HarmonicJourney : null, 'applyL2ToContext'],
      ['SectionLengthAdvisor', (typeof SectionLengthAdvisor !== 'undefined') ? SectionLengthAdvisor : null, 'advisePhraseCount'],
      ['PivotChordBridge', (typeof PivotChordBridge !== 'undefined') ? PivotChordBridge : null, 'prepareBridge'],
      ['PhaseLockedRhythmGenerator', (typeof PhaseLockedRhythmGenerator !== 'undefined') ? PhaseLockedRhythmGenerator : null, 'initializePolyrhythmCoupling'],
      ['InteractionHeatMap', (typeof InteractionHeatMap !== 'undefined') ? InteractionHeatMap : null, 'getDensity'],
      ['InteractionHeatMap', (typeof InteractionHeatMap !== 'undefined') ? InteractionHeatMap : null, 'getSystemHeat'],
      ['InteractionHeatMap', (typeof InteractionHeatMap !== 'undefined') ? InteractionHeatMap : null, 'getTrend'],
      ['InteractionHeatMap', (typeof InteractionHeatMap !== 'undefined') ? InteractionHeatMap : null, 'flushDeferredOrphans'],
      ['RhythmicPhaseLock', (typeof RhythmicPhaseLock !== 'undefined') ? RhythmicPhaseLock : null, 'getMode'],
      ['CadenceAdvisor', (typeof CadenceAdvisor !== 'undefined') ? CadenceAdvisor : null, 'shouldCadence'],
      ['TexturalMemoryAdvisor', (typeof TexturalMemoryAdvisor !== 'undefined') ? TexturalMemoryAdvisor : null, 'recordUsage'],
      ['ConvergenceHarmonicTrigger', (typeof ConvergenceHarmonicTrigger !== 'undefined') ? ConvergenceHarmonicTrigger : null, 'onConvergence'],
      ['StructuralFormTracker', (typeof StructuralFormTracker !== 'undefined') ? StructuralFormTracker : null, 'recordSection']
    ];
    requiredModules.forEach(([name, obj, method]) => {
      if (!obj || typeof obj[/** @type {string} */ (method)] !== 'function') {
        throw new Error(`MainBootstrap: ${name}.${method} is not available`);
      }
    });

    /** @type {[string, any][]} */
    const requiredInitializers = [
      ['FXFeedbackListener', (typeof FXFeedbackListener !== 'undefined') ? FXFeedbackListener : null],
      ['StutterFeedbackListener', (typeof StutterFeedbackListener !== 'undefined') ? StutterFeedbackListener : null],
      ['JourneyRhythmCoupler', (typeof JourneyRhythmCoupler !== 'undefined') ? JourneyRhythmCoupler : null],
      ['ConductorRegulationListener', (typeof ConductorRegulationListener !== 'undefined') ? ConductorRegulationListener : null],
      ['DrumTextureCoupler', (typeof DrumTextureCoupler !== 'undefined') ? DrumTextureCoupler : null],
      ['EmissionFeedbackListener', (typeof EmissionFeedbackListener !== 'undefined') ? EmissionFeedbackListener : null],
      ['HarmonicRhythmTracker', (typeof HarmonicRhythmTracker !== 'undefined') ? HarmonicRhythmTracker : null],
      ['ConductorState', (typeof ConductorState !== 'undefined') ? ConductorState : null],
      ['CadenceAdvisor', (typeof CadenceAdvisor !== 'undefined') ? CadenceAdvisor : null]
    ];
    requiredInitializers.forEach(([name, obj]) => {
      if (!obj || typeof obj.initialize !== 'function') {
        throw new Error(`MainBootstrap: ${name}.initialize is not available`);
      }
    });
  }

  return { requireFiniteNumber, requireUnitInterval, requireNonEmptyString, getConductorProbabilities, parseControls, assertBootstrapGlobals };
})();
