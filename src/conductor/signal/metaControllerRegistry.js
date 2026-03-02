// metaControllerRegistry.js - Central manifest of all hypermeta self-calibrating controllers.
// Provides a single inspectable registry of every meta-controller in the system,
// replacing the scattered #1-#11 comment convention with a queryable data structure.
//
// Every controller declares its axis, correction mechanism, gain, source file,
// and interaction partners. The conductorMetaWatchdog consumes this registry
// for authoritative conflict detection instead of heuristic sign-matching.

metaControllerRegistry = (() => {
  const V = validator.create('metaControllerRegistry');

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
      file: 'conductor/signal/pipelineCouplingManager.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'Per-pair rolling |r| EMA. Intractable correlations relax targets upward; easily resolved pairs tighten toward baseline. Product-feedback guard freezes tightening when density product < 0.75.',
      gain: '_TARGET_RELAX_RATE = 0.0015, _TARGET_TIGHTEN_RATE = 0.0015, range [0.08, 0.45]',
      interactsWith: [3, 6, 9, 11],
      interactionNotes: '#9 budget caps limit nudge room. #6 coherent relaxation scales targets. #3 density product guard freezes tightening. #11 watchdog monitors.'
    },
    {
      id: 2,
      name: 'regimeDistributionEquilibrator',
      file: 'conductor/signal/regimeReactiveDamping.js',
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
      file: 'crossLayer/structure/adaptiveTrustScores.js',
      axes: ['trust'],
      mechanism: 'Per-system trust velocity EMA. When velocity stagnates >100 beats, injects synthetic payoff proportional to gap from mean trust. Hysteresis: engage at 0.001, disengage at 0.003 after 50 beats. Nourishment decays 10% per application.',
      gain: '_BASE_NOURISHMENT_STRENGTH = 0.15, _MIN_NOURISHMENT_STRENGTH = 0.05, _NOURISHMENT_DECAY = 0.90',
      interactsWith: [],
      interactionNotes: 'Runs in crossLayer subsystem. Cannot directly conflict with conductor controllers.'
    },
    {
      id: 6,
      name: 'adaptiveCoherentRelaxation',
      file: 'conductor/signal/pipelineCouplingManager.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'EMA of coherent-regime share (~64-beat horizon). Low coherent share relaxes coupling targets (coupling IS the feature); high share tightens. Replaces static constant.',
      gain: '_COHERENT_SHARE_EMA_ALPHA = 0.015, formula 1.0 + max(0, 0.50 - share) * 1.2',
      interactsWith: [1, 2, 9],
      interactionNotes: '#1 scales target via targetScale. #2 both react to regime. #9 budget still applies on top.'
    },
    {
      id: 7,
      name: 'entropyPIController',
      file: 'conductor/signal/systemDynamicsProfiler.js',
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
      file: 'conductor/signal/pipelineCouplingManager.js',
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
      file: 'conductor/signal/conductorMetaWatchdog.js',
      axes: ['density', 'tension', 'flicker'],
      mechanism: 'Every 50 beats, checks all controller pairs per pipeline for opposing correction patterns. When >30/50 beats are opposing, attenuates the weaker controller by 50%. Relaxes attenuations when conflict subsides (+0.1/check).',
      gain: '_ATTENUATION_FACTOR = 0.50, _CONFLICT_THRESHOLD = 30, floor 0.1',
      interactsWith: [1, 2, 3, 4, 6, 7, 8, 9, 10],
      interactionNotes: 'Supervisory immune system. Fed by #10 (centroid/elasticity signs) and #2 (equilibrator signs). Attenuations queryable via getAttenuation(pipeline, controllerName).'
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
   * Get a controller by its numeric ID (1-11).
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
})();
