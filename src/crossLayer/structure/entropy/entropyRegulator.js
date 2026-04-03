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
  // R76 E5: Widen arc range 0.6->0.7 for greater entropy dynamic range,
  // creating more contrast between low-entropy and high-entropy sections.
  const ARC_TARGET_RANGE = 0.7;

  // Target blending (arc vs intent)
  // R75 E2: Raised arc weight 0.3->0.45 to strengthen structural entropy
  // motion across the composition. The arc target drives entropy to follow
  // the tension contour, creating correlated entropy-tension dynamics.
  const ARC_BLEND_WEIGHT = 0.45;
  const INTENT_BLEND_WEIGHT = 0.55;

  // PID regulation
  const GAIN_SCALE = 2.0;
  const REGULATION_CLAMP_MIN = 0.3;
  const REGULATION_CLAMP_MAX = 2.0;

  let smoothedEntropy = 0.5;
  let lastRawEntropy = 0.5;
  let targetEntropy = 0.5;
  let regulationStrength = 0.65; // Lab R1: raised from 0.5, high entropy confirmed good

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
   * Core entropy computation (runs at most once per beat via entropyRegulatorMeasureCache).
   * @private
   * @returns {number} combined 0-1
   */
  let entropyRegulatorRhythmIrregErrors = 0;
  let entropyRegulatorConsecutiveRhythmErrors = 0;
  let entropyRegulatorLastRhythmValue = 0.5;

  function entropyRegulatorComputeEntropy() {
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
        const rhythmVal = entropyMetrics.rhythmicIrregularity(layer);
        totalRhythm += rhythmVal;
        entropyRegulatorLastRhythmValue = rhythmVal;
        entropyRegulatorConsecutiveRhythmErrors = 0;
      } catch { /* boot-safety: rhythm data may not be available */
        entropyRegulatorRhythmIrregErrors++;
        entropyRegulatorConsecutiveRhythmErrors++;
        // Circuit breaker: after 3+ consecutive errors, use last known value
        if (entropyRegulatorConsecutiveRhythmErrors <= 3) {
          totalRhythm += entropyRegulatorLastRhythmValue;
        }
        // After 3 consecutive, stop contributing rhythm to entropy (reduces noise)
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
    const combined = (totalPitch / count) * PITCH_ENTROPY_WEIGHT + (totalVel / m.max(count, 1)) * VELOCITY_ENTROPY_WEIGHT + (totalRhythm / 2) * RHYTHM_ENTROPY_WEIGHT;
    smoothedEntropy = smoothedEntropy * (1 - SMOOTHING) + combined * SMOOTHING;
    lastRawEntropy = combined;
    L0.post('entropy', LM.activeLayer || 'both', beatStartTime, { smoothed: smoothedEntropy, raw: combined });
    return smoothedEntropy;
  }

  const entropyRegulatorMeasureCache = beatCache.create(entropyRegulatorComputeEntropy);

  /**
   * Measure combined entropy of both layers (EMA-smoothed).
   * @returns {number} combined 0-1
   */
  function measureEntropy() {
    return entropyRegulatorMeasureCache.get();
  }

  /**
   * Return the raw (unsmoothed) entropy from the last computation.
   * Use for trajectory analysis where EMA flattening would suppress variance.
   * Must call measureEntropy() first to ensure the cache has run.
   * @returns {number} 0-1
   */
  function measureRawEntropy() {
    entropyRegulatorMeasureCache.get(); // ensure computation has run this beat
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
      let arcWeight = ARC_BLEND_WEIGHT;
      let intentWeight = INTENT_BLEND_WEIGHT;
      let targetTrim = 0;
      const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
      const couplingMatrix = snap && snap.couplingMatrix ? snap.couplingMatrix : null;
      const sectionProgress = safePreBoot.call(() => timeStream.normalizedProgress('section'), 0.5);
      const edgeDistance = typeof sectionProgress === 'number' && Number.isFinite(sectionProgress)
        ? m.min(clamp(sectionProgress, 0, 1), clamp(1 - sectionProgress, 0, 1))
        : 0.5;
      const edgePressure = clamp((0.18 - edgeDistance) / 0.18, 0, 1);
      const densityEntropyPressure = couplingMatrix && typeof couplingMatrix['density-entropy'] === 'number' && Number.isFinite(couplingMatrix['density-entropy'])
        ? clamp((m.abs(couplingMatrix['density-entropy']) - 0.50) / 0.20, 0, 1)
        : 0;
      const densityFlickerPressure = couplingMatrix && typeof couplingMatrix['density-flicker'] === 'number' && Number.isFinite(couplingMatrix['density-flicker'])
        ? clamp((m.abs(couplingMatrix['density-flicker']) - 0.80) / 0.16, 0, 1)
        : 0;
      const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
      const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
        ? axisEnergy.shares.phase
        : 1.0 / 6.0;
      const phaseProtection = clamp((phaseShare - 0.12) / 0.05, 0, 1);
      const entropyContainment = clamp(densityEntropyPressure * 0.55 + densityFlickerPressure * 0.45, 0, 1);
      arcWeight = clamp(ARC_BLEND_WEIGHT + entropyContainment * 0.10 + edgePressure * 0.05, ARC_BLEND_WEIGHT, 0.48);
      intentWeight = 1 - arcWeight;
      targetTrim = entropyContainment * (0.02 + edgePressure * 0.03) * (0.25 + phaseProtection * 0.45);
      // Xenolinguistic L4: self-narration modulates entropy. Crowded = less entropy, sparse = more.
      const narEntry = L0.getLast('self-narration', { layer: 'both' });
      const narMod = narEntry && narEntry.narrative
        ? (narEntry.narrative.includes('crowded') ? -0.03 : narEntry.narrative.includes('sparse') ? 0.03 : 0) : 0;
      const computed = arcTarget * arcWeight + target * intentWeight - targetTrim + narMod;
      targetEntropy = Number.isFinite(computed) ? clamp(computed, 0, 1) : 0.5;
    } else {
      targetEntropy = Number.isFinite(target) ? clamp(target, 0, 1) : 0.5;
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
    const progress = Number.isFinite(sectionProgress) ? clamp(sectionProgress, 0, 1) : 0.5;
    const arc = m.sin(progress * m.PI);
    return ARC_TARGET_FLOOR + arc * ARC_TARGET_RANGE;
  }

  // Closed-loop controller: steer combined entropy toward target via dynamic gain
  const entropyRegulatorRegulationCtrl = closedLoopController.create({
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
    entropyRegulatorRegulationCtrl.refresh();
    return { scale: entropyRegulatorRegulationCtrl.getBias(), currentEntropy: current, targetEntropy, error };
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
    entropyRegulatorRegulationCtrl.reset();
    // entropyRegulatorRhythmIrregErrors intentionally NOT reset - accumulates across run for diagnostic
  }

  /** @returns {number} total rhythmicIrregularity failures across the run */
  function getRhythmErrors() { return entropyRegulatorRhythmIrregErrors; }

  return {
    recordSample, measureEntropy, measureRawEntropy, setTarget, getArcTarget,
    getRegulation, regulate, setRegulationStrength, reset, getRhythmErrors
  };
})();
crossLayerRegistry.register('entropyRegulator', entropyRegulator, ['all', 'section']);
