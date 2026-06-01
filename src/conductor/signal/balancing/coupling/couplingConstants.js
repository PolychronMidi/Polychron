

/**
 * Coupling Constants
 *
 * All immutable configuration for the pipeline coupling manager.
 * Dimension sets, pair targets, gain parameters, guard thresholds,
 * budget priority weights, and detection constants.
 */

moduleLifecycle.declare({
  name: 'couplingConstants',
  subsystem: 'conductor',
  deps: [],
  provides: ['couplingConstants'],
  init: () => {

  const NUDGEABLE = ['density', 'tension', 'flicker'];
  const NUDGEABLE_SET = new Set(NUDGEABLE);
  const NON_NUDGEABLE_SET = new Set(['entropy-trust', 'trust-phase']);
  const PHASE_SURFACE_SET = new Set(['density-phase', 'flicker-phase', 'tension-phase']);
  const ENTROPY_SURFACE_SET = new Set([
    'density-entropy', 'tension-entropy', 'flicker-entropy', 'entropy-trust', 'entropy-phase',
  ]);

  const COMPOSITIONAL_DIMS = ['density', 'tension', 'flicker', 'entropy'];
  const OBSERVABLE_DIMS = ['trust', 'phase'];
  const ALL_MONITORED_DIMS = COMPOSITIONAL_DIMS.concat(OBSERVABLE_DIMS);

  const DEFAULT_TARGET = 0.25;

  // Per-pair target overrides (targets are structural, not gains).
  const PAIR_TARGETS = {
    'density-tension':  0.15,
    'density-flicker':  0.12,
    'density-entropy':  0.12,
    'tension-flicker':  0.15,
    'tension-entropy':  0.25,
    'flicker-entropy':  0.18,
    'flicker-phase':    0.08,
    'density-phase':    0.06,
    'tension-phase':    0.20,
    'density-trust':    0.20,
    'tension-trust':    0.15,
    'flicker-trust':    0.12,
    'entropy-phase':    0.10,
    'entropy-trust':    0.30,
    'trust-phase':      0.25,
  };

  // Self-calibrating coupling target parameters (#1 hypermeta)
  const TARGET_ADAPT_EMA = 0.02;
  const TARGET_RELAX_RATE = 0.0015;
  const TARGET_TIGHTEN_RATE = 0.0015;
  const TARGET_MIN = -0.05;
  const TARGET_MAX = 0.45;
  const DENSITY_FLICKER_TARGET_MAX = 0.55;

  // Axis coupling ceilings and smoothing
  const AXIS_COUPLING_CEILING = {
    density: 2.0, tension: 2.0, flicker: 2.0, entropy: 2.0, trust: 2.2, phase: 2.0,
  };
  const AXIS_SMOOTH_ALPHA = 0.15;

  // Adaptive gain parameters
  const GAIN_INIT = 0.16;
  const GAIN_MIN  = 0.08;
  const GAIN_MAX  = 0.60;
  const GAIN_ESCALATE_RATE = 0.02;
  const GAIN_EMERGENCY_RATE = 0.06;
  const GAIN_RELAX_RATE = 0.02;
  const PAIR_GAIN_INIT = { 'density-tension': 0.24, 'entropy-phase': 0.16 };

  // Regime and budget
  const COHERENT_SHARE_EMA_ALPHA = 0.015;
  const AXIS_BUDGET = 0.24;

  // Product guard thresholds
  const FLICKER_PAIR_GAIN_CAP = 0.45;
  const FLICKER_PAIR_GAIN_CAP_THRESHOLD = 0.88;
  const DENSITY_PAIR_GAIN_CAP = 0.45;
  const DENSITY_PAIR_GAIN_CAP_THRESHOLD = 0.72;

  // Budget priority weights
  const BUDGET_PRIORITY_GAIN = {
    'density-flicker': 1.75, 'density-entropy': 1.28, 'density-phase': 1.35,
    'density-trust': 1.25, 'flicker-entropy': 1.42, 'flicker-phase': 1.45,
    'flicker-trust': 1.35, 'tension-entropy': 1.18, 'tension-phase': 1.15,
    'tension-flicker': 1.10, 'tension-trust': 1.10,
  };
  const BUDGET_DEPRIORITIZED_GAIN = 0.82;
  const BUDGET_PRIORITY_TOP_K = 5;

  // Rolling windows
  const P95_WINDOW = 16;
  const TELEMETRY_WINDOW = 96;

  // Dynamic telemetry window for long runs. Scales
  // proportionally to run length: ~96 at 640 beats, 192 cap for very long
  // runs, 48 floor for short runs.
  function dynamicTelemetryWindow(bc) {
    if (!Number.isFinite(bc) || bc < 1) return TELEMETRY_WINDOW;
    return m.max(48, m.min(m.floor(bc * 0.15), 192));
  }

  // Velocity spike detection
  const VELOCITY_EMA_ALPHA = 0.08;
  const VELOCITY_TRIGGER_RATIO = 2.0;
  const VELOCITY_BOOST_BEATS = 3;
  const VELOCITY_GAIN_BOOST = 2.0;

  // Coherence gate EMA
  const GATE_EMA_ALPHA = 0.05;

  // High-priority pair promotion
  const HP_GAIN_MAX = 0.80;
  const HP_ROLLING_THRESHOLD = 0.35;
  const HP_MAX_BEATS = 50;
  const HP_COOLDOWN_BEATS = 30;

  // Monotone circuit breaker
  const MONOTONE_TRIGGER = 22;
  const HIGH_CORR_MONOTONE_TRIGGER = 16;
  const MONOTONE_ABS_THRESHOLD = 0.50;
  const MONOTONE_IMPULSE_RATE = 2.5;

  // Pair key utilities
  function sharesAxis(pairKey, axis) {
    return typeof pairKey === 'string' && typeof axis === 'string' && pairKey.indexOf(axis) !== -1;
  }

  function sharesAnyAxis(pairKey, axes) {
    if (typeof pairKey !== 'string' || !Array.isArray(axes) || axes.length === 0) return false;
    for (let i = 0; i < axes.length; i++) {
      if (sharesAxis(pairKey, axes[i])) return true;
    }
    return false;
  }

  const TRUST_SURFACE_SET = new Set(['density-trust', 'flicker-trust', 'tension-trust']);

  // Precomputed pair topology reused across balancing subsystem
  const ALL_PAIRS = [];
  for (let pa = 0; pa < ALL_MONITORED_DIMS.length; pa++) {
    for (let pb = pa + 1; pb < ALL_MONITORED_DIMS.length; pb++) {
      ALL_PAIRS.push(ALL_MONITORED_DIMS[pa] + '-' + ALL_MONITORED_DIMS[pb]);
    }
  }

  /** @type {Record<string, string[]>} */
  const AXIS_TO_PAIRS = {};
  for (let pa = 0; pa < ALL_MONITORED_DIMS.length; pa++) {
    const axis = ALL_MONITORED_DIMS[pa];
    AXIS_TO_PAIRS[axis] = [];
    for (let pb = 0; pb < ALL_PAIRS.length; pb++) {
      if (ALL_PAIRS[pb].indexOf(axis) !== -1) AXIS_TO_PAIRS[axis].push(ALL_PAIRS[pb]);
    }
  }

  /** Classify a pair key into boolean flags used throughout the pipeline. */
  function classifyPair(key, dimA, dimB) {
    return {
      isEntropyPair: dimA === 'entropy' || dimB === 'entropy',
      isTensionEntropyPair: (dimA === 'tension' && dimB === 'entropy') || (dimA === 'entropy' && dimB === 'tension'),
      isDensityFlickerPair: key === 'density-flicker',
      isFlickerTrustPair: key === 'flicker-trust',
      isTensionPhasePair: key === 'tension-phase',
      isDensityTrustPair: key === 'density-trust',
      isDensityTensionPair: key === 'density-tension',
      isPhasePair: dimA === 'phase' || dimB === 'phase',
      isPhaseSurfacePair: PHASE_SURFACE_SET.has(key),
      isTrustPair: dimA === 'trust' || dimB === 'trust',
      isTrustSurfacePair: TRUST_SURFACE_SET.has(key),
      isEntropySurfacePair: ENTROPY_SURFACE_SET.has(key),
      isNonNudgeablePair: NON_NUDGEABLE_SET.has(key),
    };
  }

  return {
    NUDGEABLE, NUDGEABLE_SET, NON_NUDGEABLE_SET,
    PHASE_SURFACE_SET, ENTROPY_SURFACE_SET, TRUST_SURFACE_SET,
    COMPOSITIONAL_DIMS, OBSERVABLE_DIMS, ALL_MONITORED_DIMS, ALL_PAIRS, AXIS_TO_PAIRS,
    DEFAULT_TARGET, PAIR_TARGETS,
    TARGET_ADAPT_EMA, TARGET_RELAX_RATE, TARGET_TIGHTEN_RATE, TARGET_MIN, TARGET_MAX, DENSITY_FLICKER_TARGET_MAX,
    AXIS_COUPLING_CEILING, AXIS_SMOOTH_ALPHA,
    GAIN_INIT, GAIN_MIN, GAIN_MAX, GAIN_ESCALATE_RATE, GAIN_EMERGENCY_RATE, GAIN_RELAX_RATE,
    PAIR_GAIN_INIT,
    COHERENT_SHARE_EMA_ALPHA, AXIS_BUDGET,
    FLICKER_PAIR_GAIN_CAP, FLICKER_PAIR_GAIN_CAP_THRESHOLD,
    DENSITY_PAIR_GAIN_CAP, DENSITY_PAIR_GAIN_CAP_THRESHOLD,
    BUDGET_PRIORITY_GAIN, BUDGET_DEPRIORITIZED_GAIN, BUDGET_PRIORITY_TOP_K,
    P95_WINDOW, TELEMETRY_WINDOW, dynamicTelemetryWindow,
    VELOCITY_EMA_ALPHA, VELOCITY_TRIGGER_RATIO, VELOCITY_BOOST_BEATS, VELOCITY_GAIN_BOOST,
    GATE_EMA_ALPHA,
    HP_GAIN_MAX, HP_ROLLING_THRESHOLD, HP_MAX_BEATS, HP_COOLDOWN_BEATS,
    MONOTONE_TRIGGER, HIGH_CORR_MONOTONE_TRIGGER, MONOTONE_ABS_THRESHOLD, MONOTONE_IMPULSE_RATE,
    sharesAxis, sharesAnyAxis, classifyPair,
  };
  },
});
