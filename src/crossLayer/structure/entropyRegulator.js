// src/crossLayer/entropyRegulator.js - Cross-layer entropy regulation.
// Measures combined entropy (pitch diversity * rhythmic irregularity * velocity variance)
// of both layers. Defines a target entropy curve (low - high - low for tension arcs).
// Nudges all cross-layer systems up or down to steer total entropy toward the target.
// Acts as a meta-conductor for the cross-layer systems themselves.

entropyRegulator = (() => {
  const V = validator.create('entropyRegulator');
  const WINDOW_NOTES = 10; // halved (was 20) - faster window turnover creates more beat-to-beat variance
  const SMOOTHING = 0.3; // exponential smoothing factor

  // Entropy component weights
  const PITCH_ENTROPY_WEIGHT = 0.4;
  const VELOCITY_ENTROPY_WEIGHT = 0.3;
  const RHYTHM_ENTROPY_WEIGHT = 0.3;

  // Arc target range
  const ARC_TARGET_FLOOR = 0.2;
  const ARC_TARGET_RANGE = 0.6;

  // Target blending (arc vs intent)
  const ARC_BLEND_WEIGHT = 0.3;
  const INTENT_BLEND_WEIGHT = 0.7;

  // PID regulation
  const GAIN_SCALE = 2.0;
  const REGULATION_CLAMP_MIN = 0.3;
  const REGULATION_CLAMP_MAX = 2.0;

  let smoothedEntropy = 0.5;
  let lastRawEntropy = 0.5;
  let targetEntropy = 0.5;
  let regulationStrength = 0.5; // how aggressively to steer (0-1)

  /** @type {Map<string, number[]>} recent MIDI notes per layer */
  const noteHistory = new Map();
  /** @type {Map<string, number[]>} recent velocities per layer */
  const velHistory = new Map();

  /**
   * Record a note + velocity for entropy measurement.
   * @param {number} midi
   * @param {number} velocity
   * @param {string} layer
   */
  function recordSample(midi, velocity, layer) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(velocity, 'velocity');
    V.assertNonEmptyString(layer, 'layer');
    if (!noteHistory.has(layer)) noteHistory.set(layer, []);
    if (!velHistory.has(layer)) velHistory.set(layer, []);
    const nh = noteHistory.get(layer);
    const vh = velHistory.get(layer);
    if (!nh) throw new Error('entropyRegulator.recordSample: missing note history for layer ' + layer);
    if (!vh) throw new Error('entropyRegulator.recordSample: missing velocity history for layer ' + layer);
    nh.push(midi);
    vh.push(velocity);
    if (nh.length > WINDOW_NOTES) nh.shift();
    if (vh.length > WINDOW_NOTES) vh.shift();
  }

  /**
   * Core entropy computation (runs at most once per beat via _measureCache).
   * @private
   * @returns {number} combined 0-1
   */
  let _rhythmIrregErrors = 0;

  function _computeEntropy() {
    const layers = ['L1', 'L2'];
    let totalPitch = 0, totalVel = 0, totalRhythm = 0, count = 0;
    for (const layer of layers) {
      const nh = noteHistory.get(layer);
      const vh = velHistory.get(layer);
      if (nh && nh.length > 2) {
        totalPitch += entropyMetrics.pitchEntropy(nh);
        count++;
      }
      if (vh && vh.length > 2) {
        totalVel += entropyMetrics.velocityVariance(vh);
      }
      // rhythmicIrregularity queries absoluteTimeWindow which may throw
      // during early beats or section transitions. Isolate per-layer so
      // a failure in one layer doesn't abort the entire entropy measurement.
      try {
        totalRhythm += entropyMetrics.rhythmicIrregularity(layer);
      } catch (e) {
        _rhythmIrregErrors++;
        explainabilityBus.emit('entropy-rhythm-error', 'both', {
          layer,
          error: e && e.message ? e.message : 'unknown',
          errorCount: _rhythmIrregErrors
        });
      }
    }
    if (count === 0) {
      // No note history yet (early beats after section reset).
      // Still update lastRawEntropy so measureRawEntropy() doesn't
      // return stale data from before the reset.
      lastRawEntropy = 0.5;
      smoothedEntropy = 0.5;
      return 0.5;
    }
    const combined = (totalPitch / count) * PITCH_ENTROPY_WEIGHT + (totalVel / Math.max(count, 1)) * VELOCITY_ENTROPY_WEIGHT + (totalRhythm / 2) * RHYTHM_ENTROPY_WEIGHT;
    smoothedEntropy = smoothedEntropy * (1 - SMOOTHING) + combined * SMOOTHING;
    lastRawEntropy = combined;
    return smoothedEntropy;
  }

  const _measureCache = beatCache.create(_computeEntropy);

  /**
   * Measure combined entropy of both layers (EMA-smoothed).
   * @returns {number} combined 0-1
   */
  function measureEntropy() {
    return _measureCache.get();
  }

  /**
   * Return the raw (unsmoothed) entropy from the last computation.
   * Use for trajectory analysis where EMA flattening would suppress variance.
   * Must call measureEntropy() first to ensure the cache has run.
   * @returns {number} 0-1
   */
  function measureRawEntropy() {
    _measureCache.get(); // ensure computation has run this beat
    return lastRawEntropy;
  }

  /**
   * Set the target entropy for the current musical moment.
   * Can be driven by section position, conductorState, or manually.
   * @param {number} target - 0-1
   * @param {number} [arcTarget] - optional arc-shaped baseline; blended 30/70 with intent target
   */
  function setTarget(target, arcTarget) {
    if (typeof arcTarget === 'number' && Number.isFinite(arcTarget)) {
      // Blend section-shape arc with intent target
      targetEntropy = clamp(arcTarget * ARC_BLEND_WEIGHT + target * INTENT_BLEND_WEIGHT, 0, 1);
    } else {
      targetEntropy = clamp(target, 0, 1);
    }
  }

  /**
   * Compute target entropy from section position (arc curve).
   * Low at section boundaries, high in the middle.
   * @param {number} sectionProgress - 0-1 progress through current section
   * @returns {number} arc-based target 0-1 (for blending with intent)
   */
  function getArcTarget(sectionProgress) {
    // Bell curve: peaks at 0.5, troughs at 0 and 1
    const arc = Math.sin(clamp(sectionProgress, 0, 1) * Math.PI);
    return ARC_TARGET_FLOOR + arc * ARC_TARGET_RANGE;
  }

  // Closed-loop controller: steer combined entropy toward target via dynamic gain
  const _regulationCtrl = closedLoopController.create({
    name: 'entropyRegulator',
    observe: measureEntropy,
    target: () => targetEntropy,
    gain: () => regulationStrength * GAIN_SCALE,
    smoothing: 0,
    clampRange: [REGULATION_CLAMP_MIN, REGULATION_CLAMP_MAX],
    sourceDomain: 'entropy',
    targetDomain: 'cross_layer_prob'
  });

  /**
   * Get regulation modifier: how much to scale cross-layer system activity.
   * > 1 means increase activity, < 1 means decrease.
   * @returns {{ scale: number, currentEntropy: number, targetEntropy: number, error: number }}
   */
  function getRegulation() {
    const current = measureEntropy();
    const error = targetEntropy - current;
    _regulationCtrl.refresh();
    return { scale: _regulationCtrl.getBias(), currentEntropy: current, targetEntropy, error };
  }

  /**
   * Apply regulation to a probability value.
   * @param {number} prob - original probability 0-1
   * @returns {number} regulated probability 0-1
   */
  function regulate(prob) {
    const { scale } = getRegulation();
    return clamp(prob * scale, 0, 1);
  }

  /** @param {number} strength - 0-1 */
  function setRegulationStrength(strength) {
    regulationStrength = clamp(strength, 0, 1);
  }

  function reset() {
    smoothedEntropy = 0.5;
    lastRawEntropy = 0.5;
    targetEntropy = 0.5;
    regulationStrength = 0.5;
    noteHistory.clear();
    velHistory.clear();
    _regulationCtrl.reset();
    // _rhythmIrregErrors intentionally NOT reset - accumulates across run for diagnostic
  }

  /** @returns {number} total rhythmicIrregularity failures across the run */
  function getRhythmErrors() { return _rhythmIrregErrors; }

  return {
    recordSample, measureEntropy, measureRawEntropy, setTarget, getArcTarget,
    getRegulation, regulate, setRegulationStrength, reset, getRhythmErrors
  };
})();
crossLayerRegistry.register('entropyRegulator', entropyRegulator, ['all', 'section']);
