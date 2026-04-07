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
      const couplingPressures = (safePreBoot.call(() => pipelineCouplingManager.getCouplingPressures(), {})) || {};
      const sectionProgress = safePreBoot.call(() => timeStream.normalizedProgress('section'), 0.5);
      const edgeDistance = typeof sectionProgress === 'number' && Number.isFinite(sectionProgress)
        ? m.min(clamp(sectionProgress, 0, 1), clamp(1 - sectionProgress, 0, 1))
        : 0.5;
      const edgePressure = clamp((0.18 - edgeDistance) / 0.18, 0, 1);
      const densityEntropyPressure = clamp(((couplingPressures['density-entropy'] || 0) - 0.50) / 0.20, 0, 1);
      const densityFlickerPressure = clamp(((couplingPressures['density-flicker'] || 0) - 0.80) / 0.16, 0, 1);
      const bridgeAxis = conductorSignalBridge.getSignals().axisEnergyShares;
      const phaseShare = bridgeAxis && typeof bridgeAxis.phase === 'number'
        ? bridgeAxis.phase
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
      // Melodic coupling: register migration direction nudges entropy target.
      // Ascending -> more entropy (exploring new register territory needs variety).
      // Descending -> less entropy (settling into lower register invites consolidation).
      const melodicCtxER = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
      const melodicMod = melodicCtxER
        ? (melodicCtxER.registerMigrationDir === 'ascending' ? 0.02 : melodicCtxER.registerMigrationDir === 'descending' ? -0.02 : 0)
        : 0;
      // tessituraLoad: extreme register positions warrant more pitch variety -> raise entropy.
      const tessLoad = melodicCtxER ? V.optionalFinite(melodicCtxER.tessituraLoad, 0) : 0;
      const tessEntropy = tessLoad * 0.025; // 0 neutral ... +0.025 extreme register
      // R79 E1: freshnessEma antagonism bridge -- novel intervals signal uncharted territory -> raise entropy.
      // Counterpart: climaxEngine SUPPRESSES climax on freshnessEma>0.60 (R78 E3).
      // Together: fresh melody -> entropy UP + climax DOWN (constructive opposition on same signal).
      const freshnessEmaER = melodicCtxER ? V.optionalFinite(melodicCtxER.freshnessEma, 0.5) : 0.5;
      const freshnessMod = clamp((freshnessEmaER - 0.5) * 0.08, 0, 0.04); // 0 at 0.5 ... +0.04 at max novelty
      // R79 E2: ascendRatio coupling -- ascending phrases signal exploratory territory -> more entropy.
      // Descending phrases (settling) -> less entropy. More granular than ternary registerMigrationDir.
      const ascendRatioER = melodicCtxER ? V.optionalFinite(melodicCtxER.ascendRatio, 0.5) : 0.5;
      const ascendMod = clamp((ascendRatioER - 0.5) * 0.06, -0.03, 0.03); // ascending +0.03 ... descending -0.03
      // R85 E1: intervalFreshness antagonism bridge -- novel intervals signal uncharted territory -> raise entropy.
      // Counterpart: crossLayerSilhouette SHARPENS structural tracking under same signal (form holds while chaos expands).
      const intervalFreshnessER = melodicCtxER ? V.optionalFinite(melodicCtxER.intervalFreshness, 0.5) : 0.5;
      const intervalFreshnessMod = clamp((intervalFreshnessER - 0.45) * 0.07, -0.02, 0.04); // familiar -0.02 ... novel +0.04
      // R73: emergentRhythm densitySurprise coupling -- unexpected rhythmic bursts spike entropy target.
      // Surprising rhythmic events should be more chaotic/entropic by nature.
      const rhythmEntryER = L0.getLast('emergentRhythm', { layer: 'both' });
      const densitySurpriseER = rhythmEntryER && Number.isFinite(rhythmEntryER.densitySurprise) ? rhythmEntryER.densitySurprise : 0;
      // R75: motifEcho coupling -- imitative counterpoint activity suppresses entropy target (fugue structure invites order).
      const motifEchoEntry = L0.getLast('motifEcho', { layer: 'both' });
      const motifEchoMod = motifEchoEntry ? (motifEchoEntry.delayBeats <= 2 ? -0.04 : -0.02) : 0;
      // R76: climax-pressure antagonism bridge -- approaching climax suppresses entropy target.
      // Constructive opposition: climax needs definition (low entropy), entropy needs space (high).
      // Both sides coupled to entropy channel with opposing intent (r=-0.604 pair).
      const climaxEntryER = L0.getLast('climax-pressure', { layer: 'both' });
      const climaxMod = climaxEntryER && Number.isFinite(climaxEntryER.level)
        ? -clamp(climaxEntryER.level * 0.07, 0, 0.07) : 0;
      // R77 E9: complexityEma fast-chaos bridge -- high rhythmic complexity EMA amplifies entropy target
      // (counterpart: crossLayerSilhouette slows tracking under same condition)
      const complexityEmaER = rhythmEntryER && Number.isFinite(rhythmEntryER.complexityEma) ? rhythmEntryER.complexityEma : 0;
      const complexityMod = clamp((complexityEmaER - 0.5) * 0.10, 0, 0.07);
      // R78: phase-lock coupling -- repel mode (layers opposing) inherently raises entropy (counterpoint diversity),
      // lock mode (layers synchronized) creates coherent order (reduced entropy target).
      const phaseModeER = safePreBoot.call(() => rhythmicPhaseLock.getMode(), 'drift');
      const phaseMod = phaseModeER === 'repel' ? 0.04 : phaseModeER === 'lock' ? -0.03 : 0;
      // R88 E1: density antagonism bridge with temporalGravity -- high note density raises entropy target
      // (dense textures generate pitch variety naturally; entropy should open up to match).
      // Counterpart: temporalGravity STRENGTHENS pull under same signal (structure tightens while chaos expands).
      const densityER = clamp(V.optionalFinite(conductorSignalBridge.getSignals().density, 0.5), 0, 1);
      const densityEntMod = clamp((densityER - 0.5) * 0.06, -0.02, 0.04);
      // R89 E2: complexity antagonism bridge with temporalGravity -- high per-beat complexity raises entropy target
      // (complex rhythmic events open up pitch variety to match their structural richness).
      // Counterpart: temporalGravity STRENGTHENS gravity wells under same signal (temporal anchor tightens while entropy expands).
      const complexityBeatER = rhythmEntryER && Number.isFinite(rhythmEntryER.complexity) ? rhythmEntryER.complexity : 0.5;
      const complexityBeatEntMod = clamp((complexityBeatER - 0.5) * 0.04, -0.02, 0.015);
      // R90 E1: contourShape antagonism bridge with motifEcho (VIRGIN pair r=-0.503) -- rising contour raises entropy target
      // (ascending arc = exploratory territory demands pitch variety).
      // Counterpart: motifEcho REDUCES echo probability under same signal (rising motion looks forward, not backward).
      const contourShapeER = melodicCtxER ? melodicCtxER.contourShape : null;
      const contourShapeEntMod = contourShapeER === 'rising' ? 0.015 : contourShapeER === 'falling' ? -0.02 : 0;
      const computed = arcTarget * arcWeight + target * intentWeight - targetTrim + narMod + melodicMod + tessEntropy + freshnessMod + ascendMod + intervalFreshnessMod + densitySurpriseER * 0.06 + motifEchoMod + climaxMod + complexityMod + phaseMod + densityEntMod + complexityBeatEntMod + contourShapeEntMod;
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
