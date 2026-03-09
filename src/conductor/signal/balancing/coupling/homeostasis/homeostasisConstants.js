// @ts-check

/**
 * Homeostasis Constants
 *
 * All immutable configuration for the coupling homeostasis governor.
 * Energy EMA parameters, redistribution thresholds, tail pressure
 * tracking, floor recovery, and chronic dampening constants.
 */

homeostasisConstants = (() => {

  const ALL_DIMS = couplingConstants.ALL_MONITORED_DIMS;

  // Energy EMA and redistribution
  const ENERGY_EMA_ALPHA = 0.10;
  const REDISTRIBUTION_EMA_ALPHA = 0.10;
  const GAIN_FLOOR = 0.20;
  const GINI_THRESHOLD = 0.40;
  const PEAK_DECAY = 0.995;
  const BUDGET_PEAK_RATIO = 0.90;
  const PEAK_EMA_CAP_RATIO = 1.5;
  const REDIST_RELATIVE_THRESHOLD = 0.008;
  const REDIST_COOLDOWN_BEATS = 20;
  const REDIST_COOLDOWN_DECAY = 0.95;

  // Chronic dampening
  const CHRONIC_DAMPEN_THRESHOLD = 20;
  const CHRONIC_FLOOR_RELAX_RATE = 0.005;
  const CHRONIC_FLOOR_RELAX_CAP = 0.60;

  // Tail pressure tracking
  const TAIL_PRESSURE_EMA_ALPHA = 0.18;
  const TAIL_PRESSURE_DECAY = 0.97;
  const TAIL_ACTIVE_THRESHOLD = 0.08;
  const TAIL_RANKED_THRESHOLD = 0.03;
  const TAIL_PRESSURE_TRIGGER_MIN = 0.14;
  const TAIL_MEMORY_TOP_K = 5;

  // Floor recovery
  const FLOOR_RECOVERY_TRIGGER = 7;
  const FLOOR_RECOVERY_HOLD = 22;

  // Diagnostics
  const MAX_TIME_SERIES = 2000;

  // Non-nudgeable pair set (includes entropy-phase which was removed from
  // couplingConstants.NON_NUDGEABLE_SET in R70 but is still non-nudgeable
  // for homeostasis turbulence calculations)
  const NON_NUDGEABLE_SET = new Set(['entropy-trust', 'entropy-phase', 'trust-phase']);

  // Reuse precomputed pair list from couplingConstants
  const TAIL_TRACKED_PAIRS = couplingConstants.ALL_PAIRS;

  return {
    ALL_DIMS, ENERGY_EMA_ALPHA, REDISTRIBUTION_EMA_ALPHA,
    GAIN_FLOOR, GINI_THRESHOLD, PEAK_DECAY, BUDGET_PEAK_RATIO, PEAK_EMA_CAP_RATIO,
    REDIST_RELATIVE_THRESHOLD, REDIST_COOLDOWN_BEATS, REDIST_COOLDOWN_DECAY,
    CHRONIC_DAMPEN_THRESHOLD, CHRONIC_FLOOR_RELAX_RATE, CHRONIC_FLOOR_RELAX_CAP,
    TAIL_PRESSURE_EMA_ALPHA, TAIL_PRESSURE_DECAY, TAIL_ACTIVE_THRESHOLD,
    TAIL_RANKED_THRESHOLD, TAIL_PRESSURE_TRIGGER_MIN, TAIL_MEMORY_TOP_K,
    FLOOR_RECOVERY_TRIGGER, FLOOR_RECOVERY_HOLD, MAX_TIME_SERIES,
    NON_NUDGEABLE_SET, TAIL_TRACKED_PAIRS,
  };
})();
