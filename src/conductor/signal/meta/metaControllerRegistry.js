// metaControllerRegistry.js - Central manifest of all hypermeta self-calibrating controllers.
// Provides a single inspectable registry of every meta-controller in the system,
// replacing the scattered #1-#13 comment convention with a queryable data structure.
//
// Every controller declares its axis, correction mechanism, gain, source file,
// and interaction partners. The conductorMetaWatchdog consumes this registry
// for authoritative conflict detection instead of heuristic sign-matching.

moduleLifecycle.declare({
  name: 'metaControllerRegistry',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['metaControllerRegistry'],
  init: (deps) => {
  const V = deps.validator.create('metaControllerRegistry');

  /**
   * @typedef {{
   *   id: number,
   *   name: string,
   *   file: string,
   *   axes: string[],
   *   mechanism: string,
   *   gain: string,
   *   interactsWith: number[],
   *   interactionNotes: string
   * }} MetaControllerEntry
   */

  /** @type {readonly MetaControllerEntry[]} */
  const controllers = Object.freeze([
    {
      id: 1,
      name: 'selfCalibratingCouplingTargets',
      file: 'conductor/signal/balancing/pipelineCouplingManager.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'Per-pair rolling |r| EMA. Intractable correlations relax targets upward; easily resolved pairs tighten toward baseline. Product-feedback guard freezes tightening when density product < 0.75.',
      gain: '_TARGET_RELAX_RATE = 0.0015, _TARGET_TIGHTEN_RATE = 0.0015, range [0.08, 0.45]',
      interactsWith: [3, 6, 9, 11],
      interactionNotes: '#9 budget caps limit nudge room. #6 coherent relaxation scales targets. #3 density product guard freezes tightening. #11 watchdog monitors.'
    },
    {
      id: 2,
      name: 'regimeDistributionEquilibrator',
      file: 'conductor/signal/profiling/regimeReactiveDamping.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: '64-beat ring buffer tracks regime share. When exploring dominates, suppresses variety-promoting biases. Squared penalty above 60% exploring.',
      gain: '_EQUILIB_STRENGTH = 0.25',
      interactsWith: [6, 7, 11],
      interactionNotes: '#7-pin both modify tension ceiling. #6 both react to coherent share. #11 feeds correction signs to watchdog.'
    },
    {
      id: 3,
      name: 'pipelineProductCentroid',
      file: 'conductor/conductorDampening.js',
      axes: ['density', 'tension'],
      mechanism: '20-beat EMA of pipeline product. Slow corrective multiplier (up to +/-25%) when products chronically drift from 1.0. Skips flicker to avoid fighting #4.',
      gain: '_CENTROID_EMA = 0.05, _CENTROID_MAX_CORRECTION = 0.25',
      interactsWith: [4, 8, 10, 11],
      interactionNotes: '#4 explicitly excluded on flicker axis. #8 modifies product before centroid reads it. #10 feeds telemetry. #11 watchdog monitors centroid corrections.'
    },
    {
      id: 4,
      name: 'flickerRangeElasticity',
      file: 'conductor/conductorDampening.js',
      axes: ['flicker'],
      mechanism: '32-beat rolling min/max flicker range. Compressed range reduces dampening base; excessive range increases it. 3x accelerated adjustment rate.',
      gain: '_TARGET_FLICKER_RANGE = 0.15, adjustment rate 0.015, clamp [-0.15, 0.15]',
      interactsWith: [3, 8, 10, 11],
      interactionNotes: '#3 centroid skips flicker because of this. #8 progressive strength feeds into flicker product. #10 feeds telemetry. #11 watchdog monitors elasticity corrections.'
    },
    {
      id: 5,
      name: 'trustStarvationAutoNourishment',
      file: 'crossLayer/structure/trust/adaptiveTrustScores.js',
      axes: ['trust'],
      mechanism: 'Per-system trust velocity EMA. When velocity stagnates >100 beats, injects synthetic payoff proportional to gap from mean trust. Hysteresis: engage at 0.001, disengage at 0.003 after 50 beats. Nourishment decays 10% per application.',
      gain: '_BASE_NOURISHMENT_STRENGTH = 0.15, _MIN_NOURISHMENT_STRENGTH = 0.05, _NOURISHMENT_DECAY = 0.90',
      interactsWith: [],
      interactionNotes: 'Runs in crossLayer subsystem. Cannot directly conflict with conductor controllers.'
    },
    {
      id: 6,
      name: 'adaptiveCoherentRelaxation',
      file: 'conductor/signal/balancing/pipelineCouplingManager.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'EMA of coherent-regime share (~64-beat horizon). Low coherent share relaxes coupling targets (coupling IS the feature); high share tightens. Replaces static constant.',
      gain: '_COHERENT_SHARE_EMA_ALPHA = 0.015, formula 1.0 + max(0, 0.50 - share) * 1.2',
      interactsWith: [1, 2, 9],
      interactionNotes: '#1 scales target via targetScale. #2 both react to regime. #9 budget still applies on top.'
    },
    {
      id: 7,
      name: 'entropyPIController',
      file: 'conductor/signal/profiling/systemDynamicsProfiler.js',
      axes: ['entropy'],
      mechanism: 'PI controller targeting 25% entropy variance share. Adaptive alpha for faster convergence on large error. Anti-windup clamp + integral freeze when P and I terms oppose.',
      gain: '_ENTROPY_KI = 0.05, _ENTROPY_INTEGRAL_CLAMP = 3.0, range [1.0, 15.0]',
      interactsWith: [2],
      interactionNotes: '#2 regime classification depends on profiler output which depends on entropy amplification.'
    },
    {
      id: 8,
      name: 'progressiveStrengthAutoScaling',
      file: 'conductor/conductorDampening.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'Derives progressive dampening strength from active contributor count instead of hardcoded per-pipeline multipliers. More contributors = weaker per-contributor dampening. Dimensionality guard: strengthens 1.5x when effectiveDimensionality < 2.0.',
      gain: 'PROGRESSIVE_STRENGTH = 0.50, scaled by activeCount/REF_PIPELINE_SIZE, clamp [0.3, 1.5]',
      interactsWith: [3, 4, 10],
      interactionNotes: '#3 centroid sees product after progressive dampening. #4 flicker range sees product after progressive dampening. #10 telemetry reports activeCount.'
    },
    {
      id: 9,
      name: 'couplingGainBudgetManager',
      file: 'conductor/signal/balancing/pipelineCouplingManager.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'Per-axis budget caps prevent coupling manager from dominating any single pipeline when many pairs overcorrelate simultaneously. Flicker gets 1.5x budget.',
      gain: '_AXIS_BUDGET = 0.24, _FLICKER_AXIS_BUDGET = 0.36',
      interactsWith: [1, 6],
      interactionNotes: '#1 budget limits how much self-calibrated targets can drive nudges. #6 coherent relaxation reduces nudge demand, easing budget pressure.'
    },
    {
      id: 10,
      name: 'metaObservationTelemetry',
      file: 'conductor/conductorDampening.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'Per-beat diagnostics to explainabilityBus: product, centroidEma, centroidCorrection, flickerDampeningBaseAdj, activeCount. Feeds correction signs to #11 watchdog. Observation-only, no correction output.',
      gain: 'N/A (observation, no gain)',
      interactsWith: [3, 4, 11],
      interactionNotes: '#3 reads centroid correction. #4 reads flicker adjustment. #11 primary data source for conflict detection.'
    },
    {
      id: 11,
      name: 'interControllerConflictDetector',
      file: 'conductor/signal/meta/conductorMetaWatchdog.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'Every 50 beats, checks all controller pairs per pipeline for opposing correction patterns. When >30/50 beats are opposing, attenuates the weaker controller by 50%. Relaxes attenuations when conflict subsides (+0.1/check).',
      gain: '_ATTENUATION_FACTOR = 0.50, _CONFLICT_THRESHOLD = 30, floor 0.1',
      interactsWith: [1, 2, 3, 4, 6, 7, 8, 9, 10],
      interactionNotes: 'Supervisory immune system. Fed by #10 (centroid/elasticity signs) and #2 (equilibrator signs). Attenuations queryable via getAttenuation(pipeline, controllerName).'
    },
    {
      id: 12,
      name: 'couplingHomeostasis',
      file: 'conductor/signal/balancing/couplingHomeostasis.js',
      axes: ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'],
      mechanism: 'Whole-system coupling energy governor. Tracks total |r| as single scalar, detects redistribution (total stable + pair turbulent = balloon effect), applies global gain throttle via pipelineCouplingManager.setGlobalGainMultiplier(). Gini coefficient concentration guard penalizes energy concentration in few pairs. Self-derives energy budget from adaptive target baselines.',
      gain: '_GAIN_THROTTLE_RATE = 0.01, _GAIN_RECOVERY_RATE = 0.02, _GAIN_FLOOR = 0.20, _GINI_THRESHOLD = 0.40',
      interactsWith: [1, 6, 9, 11],
      interactionNotes: '#1 targets feed budget self-derivation. #9 budget manager receives throttled gains from global multiplier. #6 coherent relaxation reduces inputs to total energy. #11 watchdog may detect conflict between homeostasis throttle and per-pair escalation.'
    },
    {
      id: 13,
      name: 'axisEnergyEquilibrator',
      file: 'conductor/signal/balancing/axisEnergyEquilibrator.js',
      axes: ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'],
      mechanism: 'Two-layer omnipotent coupling self-correction. Layer 1: pair-level hotspot detection via rollingAbsCorr -- tightens pairs exceeding 1.5x baseline, relaxes pairs below 0.3x baseline. Layer 2: axis-level energy balancing via getAxisEnergyShare() -- nudges all pairs on overloaded (>0.22) or suppressed (<0.12) axes. Gini-escalated rates. Trust-axis rate scaling: axes with fewer nudgeable pairs (trust/entropy/phase=3) get proportionally faster relaxation via _EFFECTIVE_NUDGEABLE map. Per-regime telemetry tracks regimeBeats, regimePairAdj, regimeAxisAdj, regimeTightenBudget for diagnostic extraction. Permanently eliminates manual whack-a-mole.',
      gain: 'L1: _PAIR_TIGHTEN_RATE=0.003, _PAIR_RELAX_RATE=0.0015, _PAIR_COOLDOWN=3. L2: _AXIS_TIGHTEN_RATE=0.002, _AXIS_RELAX_RATE=0.0012, _AXIS_COOLDOWN=4, _GINI_ESCALATION=0.40, _RELAX_RATE_REF=5, _EFFECTIVE_NUDGEABLE={density:5,tension:5,flicker:5,entropy:3,trust:3,phase:3}',
      interactsWith: [1, 9, 12],
      interactionNotes: '#1 self-calibrating targets: this controller modifies the same pair baselines that #1 adapts. #9 budget manager: changed baselines affect gain allocation. #12 homeostasis: energy redistribution changes trigger/relax the global multiplier.'
    },
    {
      id: 14,
      name: 'phaseFloorController',
      file: 'conductor/signal/balancing/phaseFloorController.js',
      axes: ['phase'],
      mechanism: 'Self-calibrating phase energy floor. Derives collapse thresholds from rolling phase volatility EMA, streak activation counts from coherent regime duration EMA, and boost multipliers from continuous graduated formula (deficit severity x recovery success). Replaces hardcoded 0.01/0.02/0.03 share thresholds, 8/12/20 streak counts, and 4.0/6.0/8.0/12.0/20.0 boost step-function with adaptive logic.',
      gain: 'Continuous boost range [3.0, 25.0] graduated by deficit ratio and recovery EMA. Collapse threshold range [0.01, 0.04]. Floor activation streak range [6, 20]. Extreme collapse streak range [4, 14].',
      interactsWith: [12, 13],
      interactionNotes: '#13 axisEnergyEquilibrator consumes phaseFloorController outputs for phase axis relaxation boosts and gate bypass decisions. #12 homeostasis: phase recovery changes affect total energy budget.'
    },
    {
      id: 15,
      name: 'pairGainCeilingController',
      file: 'conductor/signal/balancing/coupling/pairGainCeilingController.js',
      axes: ['density', 'tension', 'flicker', 'trust'],
      mechanism: 'Self-calibrating per-pair gain ceilings. Per-pair rolling p95 EMA and exceedance rate EMA drive adaptive ceiling that tightens when tail pressure exceeds sensitivity threshold and relaxes when pressure subsides. Instant overrides for extreme current-beat telemetry. Replaces hardcoded density-flicker (0.08/0.10/0.15), tension-flicker (0.08), flicker-trust (0.10), tension-trust (0.10) ceiling chains.',
      gain: 'Per-pair ceiling range from minCeiling (0.04-0.06) to maxCeiling (0.25-0.40). Tighten rate 0.008, relax rate 0.003. Sensitivity profiles per pair.',
      interactsWith: [9, 12, 13],
      interactionNotes: '#9 budget manager: ceiling limits interact with budget-ranked gain. #12 homeostasis: ceilings prevent pairs from consuming disproportionate energy. #13 axisEnergyEquilibrator: ceiling-limited nudges affect axis energy distribution.'
    },
    {
      id: 16,
      name: 'warmupRampController',
      file: 'conductor/signal/balancing/coupling/warmupRampController.js',
      axes: ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'],
      mechanism: 'Self-calibrating per-pair section-0 warmup ramp. Derives warmup beat count from historical S0 exceedance EMA and section length EMA. Pairs that historically spike during S0 get longer ramps; pairs needing immediate decorrelation get shorter ramps. Replaces hardcoded 12-beat (density-flicker) and 36-beat (others) warmup constants.',
      gain: 'Per-pair warmup range: density-flicker [6, 24] base 12; others [16, 48] base 30. Section length scaling [0.5, 1.5].',
      interactsWith: [12, 15, 17],
      interactionNotes: '#15 pairGainCeilingController: warmup ramp interacts with ceiling during S0 -- both affect early-section gain. #12 homeostasis: warmup ramp duration affects early energy budget pressure. #17 orchestrator: manages rate multipliers and S0 tightening authority.'
    },
    {
      id: 18,
      name: 'correlationShuffler',
      file: 'conductor/signal/meta/manager/correlationShuffler.js',
      axes: ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'],
      mechanism: 'Feedback loop correlation detection and perturbation. Tracks rolling Pearson correlation between all registered feedback loop outputs (amplitude + phase). Detects reinforcement spirals (corr > 0.65 for 40+ beats), tug-of-war (anti-corr < -0.65), cross-domain amplitude lock, and stasis (all loops flat > 100 beats). Applies graduated shuffle interventions: magnitude perturbation, timing rotation, stasis breaks. Inversely health-gated (shuffles MORE under stress). Self-tuning via recovery attribution (12-beat window) and confidence EMA.',
      gain: 'Perturbation scale 0.5-1.4x, duration 8-25 beats, confidence range [0.2, 1.0]',
      interactsWith: [11, 12, 17],
      interactionNotes: '#11 watchdog detects controller-level conflicts; shuffler detects loop-level correlations (layer above). #12 homeostasis: shuffle perturbations affect total energy. #17 orchestrator: shuffler ticks within orchestration interval.'
    },
    {
      id: 17,
      name: 'hyperMetaManager',
      file: 'conductor/signal/meta/manager/hyperMetaManager.js',
      axes: ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'],
      mechanism: 'Hyperhypermeta master orchestrator. Centralizes all 16 hypermeta controllers into a unified dynamic self-corrector. Every 25 beats: gathers controller snapshots, computes system health composite, detects cross-controller contradictions, derives adaptive rate multipliers, tracks controller effectiveness, and manages axis exceedance concentration diagnostics. Subsumes R98 evolutions E1 (phase boost ceiling), E3 (p95 alpha scaling), E4 (S0 tightening), E6 (axis concentration).',
      gain: '_ORCHESTRATE_INTERVAL = 25, _HEALTH_EMA_ALPHA = 0.08, _INTERVENTION_BUDGET = 0.60, phase boost ceiling [25.0, 35.0], p95 alpha multiplier [1.0, 1.8], S0 tightening multiplier [1.0, 1.4]',
      interactsWith: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      interactionNotes: 'Supervisory master orchestrator. Reads state from all 16 controllers. Provides rate multipliers queryable via getRateMultiplier(). Detects contradictions beyond watchdog (#11) scope. Manages phase boost authority (#14), p95 EMA scaling (#15), S0 tightening (#15/#16), axis concentration diagnostics.'
    }
  ]);

  // Note: #7 has a companion sub-controller:
  // "Tension Pin Relief Valve" in regimeReactiveDamping.js
  // When tension bias pins at ceiling >10 consecutive beats, relaxes ceiling by
  // 5% increments (up to 30% of base). Resets after 5 unpinned beats.
  // Interacts with #2 (equilibrator also modifies tension) and #11 (watchdog sees tension corrections).

  /**
   * Get all registered meta-controllers.
   * @returns {readonly MetaControllerEntry[]}
   */
  function getAll() {
    return controllers;
  }

  /**
   * Get a controller by its numeric ID (1-16).
   * @param {number} id
   * @returns {MetaControllerEntry|undefined}
   */
  function getById(id) {
    return controllers.find(c => c.id === id);
  }

  /**
   * Get all controllers that operate on a given axis.
   * @param {string} axis - 'density', 'tension', 'flicker', 'entropy', or 'trust'
   * @returns {MetaControllerEntry[]}
   */
  function getByAxis(axis) {
    V.assertNonEmptyString(axis, 'axis');
    return controllers.filter(c => c.axes.includes(axis));
  }

  /**
   * Get controllers that interact with a specific controller.
   * @param {number} id
   * @returns {MetaControllerEntry[]}
   */
  function getInteractors(id) {
    return controllers.filter(c => c.interactsWith.includes(id));
  }

  /**
   * Get a diagnostic snapshot of the full registry.
   * @returns {{ count: number, axes: string[], controllers: readonly MetaControllerEntry[] }}
   */
  function getSnapshot() {
    const axisSet = new Set();
    for (const ctrl of controllers) {
      for (const axis of ctrl.axes) axisSet.add(axis);
    }
    return {
      count: controllers.length,
      axes: Array.from(axisSet),
      controllers
    };
  }

  return { getAll, getById, getByAxis, getInteractors, getSnapshot };
  },
});
