// @ts-check

/**
 * Pipeline Coupling Manager (E6)
 *
 * Dynamic decorrelation engine for ALL compositional dimension pairs.
 * Reads the full coupling matrix from systemDynamicsProfiler each beat
 * and applies decorrelation nudges to any pair whose |r| exceeds its
 * target. This is the meta-solution: no hardcoded pairs, no whack-a-mole
 * when new correlations emerge between runs.
 *
 * Nudgeable axes: density, tension, flicker (conductor biases exist).
 * Entropy has no conductor bias — for pairs involving entropy, the
 * non-entropy partner is nudged.
 */

pipelineCouplingManager = (() => {

  // Dimensions managed by conductor bias pipelines
  const NUDGEABLE = ['density', 'tension', 'flicker'];
  const NUDGEABLE_SET = new Set(NUDGEABLE);

  // The 4 compositional dimensions whose pairs we monitor
  const COMPOSITIONAL_DIMS = ['density', 'tension', 'flicker', 'entropy'];

  // Default coupling target and gain for any compositional pair.
  const DEFAULT_TARGET = 0.25;
  const DEFAULT_GAIN   = 0.16;

  // Per-pair overrides from tuning history (runs 1-5).
  // Missing pairs fall through to DEFAULT_TARGET / DEFAULT_GAIN.
  const PAIR_OVERRIDES = {
    'density-tension':  { target: 0.20, gain: 0.24 }, // naturally decorrelated; prevent overcorrection
    'tension-flicker':  { target: 0.30, gain: 0.21 }, // some correlation is natural (both respond to intensity)
    'flicker-entropy':  { target: 0.25, gain: 0.12 }, // gentle — entropy nudge is indirect
  };

  const FATIGUE_RATE     = 0.05;
  const RECOVERY_RATE    = 0.10;
  const MAX_FATIGUE_DAMP = 0.80;

  // Per-pipeline accumulators and fatigue state
  let biasDensity = 1.0;
  let biasTension = 1.0;
  let biasFlicker = 1.0;
  let fatigueDensity = 0;
  let fatigueTension = 0;
  let fatigueFlicker = 0;

  /**
   * Get target and gain for a pair key, falling back to defaults.
   * @param {string} pairKey
   * @returns {{ target: number, gain: number }}
   */
  function _getConfig(pairKey) {
    const ov = PAIR_OVERRIDES[pairKey];
    return ov || { target: DEFAULT_TARGET, gain: DEFAULT_GAIN };
  }

  function refresh() {
    const snap = systemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      biasDensity = 1.0;
      biasTension = 1.0;
      biasFlicker = 1.0;
      explainabilityBus.emit('COUPLING_SKIP', 'both', { reason: 'no profiler snapshot yet' });
      return;
    }

    // Accumulate decorrelation nudges across all overcoupled compositional pairs
    let nudgeD = 0;
    let nudgeT = 0;
    let nudgeF = 0;

    /** @param {string} axis  @param {number} amount */
    function _addNudge(axis, amount) {
      if (axis === 'density') nudgeD += amount;
      else if (axis === 'tension') nudgeT += amount;
      else nudgeF += amount;
    }

    const matrix = snap.couplingMatrix;

    for (let a = 0; a < COMPOSITIONAL_DIMS.length; a++) {
      for (let b = a + 1; b < COMPOSITIONAL_DIMS.length; b++) {
        const dimA = COMPOSITIONAL_DIMS[a];
        const dimB = COMPOSITIONAL_DIMS[b];
        const key = dimA + '-' + dimB;
        const corr = matrix[key];
        if (typeof corr !== 'number' || !Number.isFinite(corr)) continue;

        const { target, gain } = _getConfig(key);
        const absCorr = m.abs(corr);
        if (absCorr <= target) continue;

        // Split decorrelation nudge across BOTH nudgeable axes in opposite
        // directions. Single-axis nudging caused accidental co-movement when
        // multiple pairs pushed the same axis the same way (Run 6: d-f flipped
        // sign but kept |0.466| — both density and flicker pushed < 1.0).
        const aIsNudgeable = NUDGEABLE_SET.has(dimA);
        const bIsNudgeable = NUDGEABLE_SET.has(dimB);
        if (!aIsNudgeable && !bIsNudgeable) continue;

        const excess = absCorr - target;
        const direction = -m.sign(corr);
        const magnitude = gain * excess;

        if (aIsNudgeable && bIsNudgeable) {
          // Both axes have conductor biases — split the force oppositely
          const half = magnitude * 0.5;
          _addNudge(dimA, -direction * half); // push A one way
          _addNudge(dimB, direction * half);  // push B the other
        } else {
          // Only one axis nudgeable (entropy pair) — full force on the nudgeable one
          const target2 = aIsNudgeable ? dimA : dimB;
          _addNudge(target2, direction * magnitude);
        }
      }
    }

    biasDensity = 1.0 + nudgeD;
    biasTension = 1.0 + nudgeT;
    biasFlicker = 1.0 + nudgeF;

    // --- Fatigue mechanism ---
    // Sustained high bias accumulates fatigue; fatigue dampens toward 1.0.
    _applyFatigue('density');
    _applyFatigue('tension');
    _applyFatigue('flicker');
  }

  /**
   * @param {'density' | 'tension' | 'flicker'} axis
   */
  function _applyFatigue(axis) {
    const bias = axis === 'density' ? biasDensity : axis === 'tension' ? biasTension : biasFlicker;
    let fatigue = axis === 'density' ? fatigueDensity : axis === 'tension' ? fatigueTension : fatigueFlicker;

    const deviation = m.abs(bias - 1.0);
    fatigue = deviation > 0.04
      ? clamp(fatigue + FATIGUE_RATE * deviation, 0, 1)
      : clamp(fatigue - RECOVERY_RATE, 0, 1);

    let result = bias;
    if (fatigue > 0) {
      result = 1.0 + (bias - 1.0) * (1.0 - fatigue * MAX_FATIGUE_DAMP);
    }

    if (axis === 'density') { biasDensity = result; fatigueDensity = fatigue; }
    else if (axis === 'tension') { biasTension = result; fatigueTension = fatigue; }
    else { biasFlicker = result; fatigueFlicker = fatigue; }
  }

  function densityBias() { return biasDensity; }
  function tensionBias() { return biasTension; }
  function flickerBias() { return biasFlicker; }

  function reset() {
    biasDensity = 1.0;
    biasTension = 1.0;
    biasFlicker = 1.0;
    fatigueDensity = 0;
    fatigueTension = 0;
    fatigueFlicker = 0;
  }

  // --- Self-registration ---
  conductorIntelligence.registerDensityBias('pipelineCouplingManager', densityBias, 0.85, 1.15);
  conductorIntelligence.registerTensionBias('pipelineCouplingManager', tensionBias, 0.84, 1.20);
  conductorIntelligence.registerFlickerModifier('pipelineCouplingManager', flickerBias, 0.88, 1.12);
  conductorIntelligence.registerRecorder('pipelineCouplingManager', refresh);
  conductorIntelligence.registerModule('pipelineCouplingManager', { reset }, ['section']);

  feedbackRegistry.registerLoop(
    'pipelineCouplingManager',
    'coupling_matrix',
    'density_tension_flicker',
    () => (m.abs(biasDensity - 1.0) + m.abs(biasTension - 1.0) + m.abs(biasFlicker - 1.0)) / 0.60,
    () => m.sign(biasTension - 1.0)
  );

  return { densityBias, tensionBias, flickerBias, reset };
})();
