// coordinationIndependenceManager.js - Dynamic coordination/independence dial
// for cross-layer module pairs. Manages how independently or coordinatedly
// modules behave, switching based on regime, phase, health, entropy, topology,
// and self-assessed effectiveness. Lives in crossLayer (reads conductor via
// bridge, writes to peer crossLayer modules via setCoordinationScale).

coordinationIndependenceManager = (() => {
  const V = validator.create('coordinationIndependenceManager');

  // Module pairs and their coordination dials (0=independent, 1=coordinated)
  const MODULE_PAIRS = [
    'restSync-rhythmComplement',
    'stutterContagion-stutterVariants',
    'spectralComp-velocityInterference',
    'feedbackOsc-emergentDownbeat',
    'stutterChannels-coordination',
    'harmonic-pitchCorrection',
    'rhythm-phaseLockGravity',
    'dynamics-envelopeInterference',
    'dynamics-articulationTexture',
    'rhythm-grooveConvergence',
    'structure-trustNegotiation',
    'motif-echoIdentity'
  ];

  const _cimc = typeof controllerConfig !== 'undefined' ? controllerConfig.getSection('coordinationIndependenceManager') : {};
  const TICK_INTERVAL = V.optionalFinite(_cimc.tickInterval, 4);
  const MIN_DWELL_BEATS = V.optionalFinite(_cimc.minDwellBeats, 12);
  // R26 E4: Per-pair stagger breaks simultaneous adjustment/evaluation so
  // effectiveness tracks per-pair health attribution, not shared global delta.
  // R26 listen: stagger=2 over-delayed high-index pairs (32 beat dwell for pair 10),
  // blocking coherent formation. Reduced to 1 (max dwell 22, 10 beat spread).
  const PAIR_DWELL_STAGGER = 1;
  const SELF_INTERFERENCE_WINDOW = 3;
  const EFFECTIVENESS_ALPHA = V.optionalFinite(_cimc.effectivenessAlpha, 0.06);
  const DIAL_STEP = V.optionalFinite(_cimc.dialStep, 0.08);

  // Phase targets: what coordination level each section phase wants
  const PHASE_TARGETS = {
    intro: 0.3, opening: 0.35, exposition: 0.45, development: 0.5,
    climax: 0.8, resolution: 0.6, conclusion: 0.55, coda: 0.4
  };

  // Regime targets: coherent = coordinate, exploring = independent
  const _BASE_REGIME_TARGETS = {
    coherent: 0.75, exploring: 0.25, evolving: 0.5, oscillating: 0.55,
    drifting: 0.3, fragmented: 0.2, stagnant: 0.4
  };
  // Metaprofile phase axis: layerIndependence biases all targets.
  // Independence 0.5 (default) = 1.0x. Atmospheric 0.3 = coordination boost. Chaotic 0.8 = independence boost.
  function _getRegimeTarget(regime) {
    const base = _BASE_REGIME_TARGETS[regime];
    if (base === undefined) return 0.5;
    if (typeof metaProfiles !== 'undefined' && metaProfiles.isActive()) {
      const independence = metaProfiles.getAxisValue('phase', 'layerIndependence', 0.5);
      // Scale: independence 0.0 → +0.2 coordination boost, 1.0 → -0.3 (more independent)
      const bias = (0.5 - independence) * 0.5;
      return clamp(base + bias, 0.05, 0.95);
    }
    return base;
  }

  // Topology targets: crystallized = break coordination, resonant = maintain, fluid = loosen
  const TOPOLOGY_TARGETS = {
    crystallized: 0.3, resonant: 0.6, fluid: 0.4
  };

  /** @type {Record<string, number>} */
  const dials = {};
  /** @type {Record<string, number>} */
  const dialTargets = {};
  /** @type {Record<string, number>} */
  const beatsSinceChange = {};
  /** @type {Record<string, number>} */
  const effectiveness = {};
  /** @type {Record<string, number>} */
  const healthAtLastChange = {};
  let oscillationEnabled = false;
  let oscillationBeat = 0;
  let tickCount = 0;

  function initPair(pair) {
    if (dials[pair] === undefined) {
      dials[pair] = 0.5;
      dialTargets[pair] = 0.5;
      beatsSinceChange[pair] = 0;
      effectiveness[pair] = 0.5;
      healthAtLastChange[pair] = 0.7;
    }
  }

  for (let i = 0; i < MODULE_PAIRS.length; i++) initPair(MODULE_PAIRS[i]);

  // Cross-run warm-start: restore terminal dial and effectiveness state from previous run
  try {
    const _cimFs = require('fs');
    const _cimPath = require('path').join(process.cwd(), 'metrics', 'adaptive-state.json');
    if (_cimFs.existsSync(_cimPath)) {
      const _cimState = JSON.parse(_cimFs.readFileSync(_cimPath, 'utf8'));
      if (_cimState.cimDials && typeof _cimState.cimDials === 'object') {
        for (let i = 0; i < MODULE_PAIRS.length; i++) {
          const p = MODULE_PAIRS[i];
          if (Number.isFinite(_cimState.cimDials[p])) dials[p] = clamp(_cimState.cimDials[p], 0, 1);
          if (_cimState.cimEffectiveness && Number.isFinite(_cimState.cimEffectiveness[p])) {
            effectiveness[p] = clamp(_cimState.cimEffectiveness[p], 0, 1);
          }
        }
      }
    }
  } catch (_cimErr) { console.warn('Acceptable warning: coordinationIndependenceManager: warm-start load failed:', _cimErr && _cimErr.message ? _cimErr.message : _cimErr); }

  /**
   * Compute the target coordination level for a pair based on all signals.
   * @param {string} pair
   * @param {Object} sigs - conductorSignalBridge signals
   * @returns {number} target 0-1
   */
  function computeTarget(pair, sigs) {
    const phase = sigs.sectionPhase || 'development';
    // Xenolinguistic L2: regime superposition -- blend targets by probability instead of hard switch
    const rp = V.optionalType(sigs.regimeProb, 'object', { coherent: 0.33, exploring: 0.33, evolving: 0.34 });
    const phaseTarget = PHASE_TARGETS[phase];
    if (phaseTarget === undefined) throw new Error('coordinationIndependenceManager: unknown sectionPhase "' + phase + '"');
    const regimeTarget = _getRegimeTarget('coherent') * rp.coherent
      + _getRegimeTarget('exploring') * rp.exploring
      + _getRegimeTarget('evolving') * rp.evolving;
    const topoTarget = TOPOLOGY_TARGETS[sigs.topologyPhase];
    if (topoTarget === undefined) throw new Error('coordinationIndependenceManager: unknown topologyPhase "' + sigs.topologyPhase + '"');

    // Intent-aware: read actual interactionTarget from sectionIntentCurves
    // which encodes trajectory learning, contrast bias, and phase position.
    // Blends with the static phase target for a more nuanced dial.
    const lastIntent = safePreBoot.call(() => sectionIntentCurves.getLastIntent(), null);
    const intentInteraction = lastIntent ? clamp(V.optionalFinite(lastIntent.interactionTarget, 0.5), 0, 1) : 0.5;

    // Entropy modulation: high coherenceEntropy = loosen coordination
    const entropyBias = clamp((sigs.coherenceEntropy - 0.5) * -0.3, -0.15, 0.15);

    // Density modulation: very low density = more independence (let things explore)
    const densityBias = sigs.density < 0.5 ? -0.1 : sigs.density > 1.5 ? 0.1 : 0;

    // Xenolinguistic L4: read self-narration. System adapts coordination based on its own description.
    const narrationEntry = L0.getLast(L0_CHANNELS.selfNarration, { layer: 'both' });
    const narrativeBias = narrationEntry && narrationEntry.narrative
      ? (narrationEntry.narrative.includes('crowded') ? 0.1 : narrationEntry.narrative.includes('sparse') ? -0.1 : 0) : 0;

    // Canon mode reduces stutter channel coordination to prevent overcrowding
    // (canon already adds rhythmic complexity via delayed imitation)
    const rhythmMode = safePreBoot.call(() => rhythmicComplementEngine.getMode(), 'free');
    const canonBias = (rhythmMode === 'canon' && pair === 'stutterChannels-coordination') ? -0.15 : 0;

    // Effectiveness modulation: if coordination worked well for this pair, bias toward it
    const effectBias = (effectiveness[pair] - 0.5) * 0.2;

    // Melodic coupling: counterpoint motion type biases coordination target.
    // Scoped to harmonic/melodic pairs only -- applying globally was too aggressive
    // (contrary is normal in polyphony; -0.08 across all 12 pairs halved note output).
    // Similar motion -> mild coordination boost for the whole system.
    const melodicCtxCIM = emergentMelodicEngine.getContext();
    const isHarmonicPair = pair === 'harmonic-pitchCorrection' || pair === 'motif-echoIdentity';
    const counterpointBias = melodicCtxCIM
      ? (melodicCtxCIM.counterpoint === 'contrary' && isHarmonicPair ? -0.06
        : melodicCtxCIM.counterpoint === 'similar' ? 0.04 : 0)
      : 0;

    // Composite target: intent-aware blend replaces the static 0.5 baseline
    const raw = phaseTarget * 0.25 + regimeTarget * 0.25 + topoTarget * 0.15 + intentInteraction * 0.35
      + entropyBias + densityBias + effectBias + canonBias + narrativeBias + counterpointBias;
    return clamp(raw, 0.05, 0.95);
  }

  /**
   * Main tick: update dial targets and ease dials toward targets.
   * Phase-gated: only adjust during stabilized system phase.
   * Self-interference detection: revert on health drop.
   */
  function tick() {
    tickCount++;
    if (tickCount % TICK_INTERVAL !== 0) return;

    const sigs = conductorSignalBridge.getSignals();
    const healthEma = sigs.healthEma;
    const systemPhase = sigs.systemPhase;

    // Self-interference detection: if health dropped since last change, revert toward neutral
    for (let i = 0; i < MODULE_PAIRS.length; i++) {
      const pair = MODULE_PAIRS[i];
      if (beatsSinceChange[pair] > 0 && beatsSinceChange[pair] <= SELF_INTERFERENCE_WINDOW) {
        if (healthEma < healthAtLastChange[pair] - 0.05) {
          // Health dropped after recent dial change - revert toward neutral
          dials[pair] += (0.5 - dials[pair]) * 0.4;
          effectiveness[pair] += (0.2 - effectiveness[pair]) * EFFECTIVENESS_ALPHA * 3;
        }
      }
      beatsSinceChange[pair]++;
    }

    // R26: auto-activate oscillation mode during oscillating regime
    const regimeForOsc = /** @type {string} */ (regimeClassifier.getLastRegime());
    if (regimeForOsc === 'oscillating' && !oscillationEnabled) { oscillationEnabled = true; oscillationBeat = 0; }
    else if (regimeForOsc !== 'oscillating' && oscillationEnabled) { oscillationEnabled = false; }

    // Phase gating: adjust during stabilized (full speed) or converging (half speed).
    // Only freeze during oscillating system phase (let hypermeta recover).
    // Exception: if health is very low (<0.4), shuffle dials to break out.
    const canAdjust = systemPhase !== 'oscillating' || healthEma < 0.4;
    if (!canAdjust) { applyDials(); return; }

    // Low health emergency shuffle: randomize dials to break stuck state
    if (healthEma < 0.4) {
      for (let i = 0; i < MODULE_PAIRS.length; i++) {
        const pair = MODULE_PAIRS[i];
        if (beatsSinceChange[pair] > MIN_DWELL_BEATS) {
          dials[pair] = rf(0.15, 0.85);
          beatsSinceChange[pair] = 0;
          healthAtLastChange[pair] = healthEma;
        }
      }
      applyDials();

      return;
    }

    // R24: CIM oscillation mode - periodic coordination breathing
    if (oscillationEnabled) {
      oscillationBeat++;
      const period = 14 + m.round(rf(-2, 2));
      const osc = m.sin(oscillationBeat / period * m.PI * 2);
      const oscTarget = 0.5 + osc * 0.3 + rf(-0.05, 0.05);
      for (let i = 0; i < MODULE_PAIRS.length; i++) {
        dials[MODULE_PAIRS[i]] = clamp(oscTarget, 0.15, 0.85);
      }
      applyDials();
      return;
    }

    // Normal operation: compute targets and ease dials toward them
    // R26 E4: staggered dwell per pair for temporal separation
    for (let i = 0; i < MODULE_PAIRS.length; i++) {
      const pair = MODULE_PAIRS[i];
      if (beatsSinceChange[pair] < MIN_DWELL_BEATS + i * PAIR_DWELL_STAGGER) continue;

      const target = computeTarget(pair, sigs);
      dialTargets[pair] = target;

      const diff = target - dials[pair];
      // Converging phase: half-speed dial movement for gentler adjustment
      const effectiveStep = systemPhase === 'converging' ? DIAL_STEP * 0.5 : DIAL_STEP;
      if (m.abs(diff) > 0.02) {
        const prevDial = dials[pair];
        dials[pair] += clamp(diff, -effectiveStep, effectiveStep);
        if (m.abs(dials[pair] - prevDial) > 0.01) {
          beatsSinceChange[pair] = 0;
          healthAtLastChange[pair] = healthEma;
        }
      }
    }

    // Track effectiveness: did health improve since last change?
    // R26 E4: evaluation window staggered per pair to isolate health attribution
    for (let i = 0; i < MODULE_PAIRS.length; i++) {
      const pair = MODULE_PAIRS[i];
      const evalStart = SELF_INTERFERENCE_WINDOW + i * PAIR_DWELL_STAGGER;
      if (beatsSinceChange[pair] > evalStart && beatsSinceChange[pair] < evalStart + 8) {
        const improved = healthEma > healthAtLastChange[pair];
        const outcome = improved ? 0.7 : 0.3;
        effectiveness[pair] += (outcome - effectiveness[pair]) * EFFECTIVENESS_ALPHA;
      }
    }

    applyDials();
  }

  /**
   * Apply current dials to target modules via setCoordinationScale.
   */
  function applyDials() {
    const restRhythm = dials['restSync-rhythmComplement'];
    const stutterContagionDial = dials['stutterContagion-stutterVariants'];
    const spectralVelocity = dials['spectralComp-velocityInterference'];
    const feedbackDownbeat = dials['feedbackOsc-emergentDownbeat'];
    const stutterChannelDial = dials['stutterChannels-coordination'];

    // restSynchronizer: shared rest probability scales with coordination
    safePreBoot.call(() => restSynchronizer.setCoordinationScale(restRhythm), null);

    // rhythmicComplementEngine: mode change interval scales inversely with coordination
    safePreBoot.call(() => rhythmicComplementEngine.setCoordinationScale(restRhythm), null);

    // stutterContagion: decay rate scales with coordination (coordinated = sticky)
    safePreBoot.call(() => stutterContagion.setCoordinationScale(stutterContagionDial), null);

    // spectralComplementarity: nudge strength scales with coordination
    safePreBoot.call(() => spectralComplementarity.setCoordinationScale(spectralVelocity), null);

    // feedbackOscillator: energy routing scales with coordination
    safePreBoot.call(() => feedbackOscillator.setCoordinationScale(feedbackDownbeat), null);

    // emergentDownbeat: layer swap probability scales inversely with coordination
    safePreBoot.call(() => emergentDownbeat.setCoordinationScale(feedbackDownbeat), null);

    // emergentRhythmEngine: grid sensitivity + bias strength scale with coordination
    safePreBoot.call(() => emergentRhythmEngine.setCoordinationScale(feedbackDownbeat), null);
    // stutter channel coordination: how many channels stutter together
    safePreBoot.call(() => StutterManager.setChannelCoordinationScale(stutterChannelDial), null);

    // Harmonic pitch correction: interval guard + collision avoidance
    const harmonicDial = dials['harmonic-pitchCorrection'];
    safePreBoot.call(() => harmonicIntervalGuard.setCoordinationScale(harmonicDial), null);
    // emergentMelodicEngine: noveltyWeight amplification scales with harmonic coordination
    emergentMelodicEngine.setCoordinationScale(harmonicDial);
    safePreBoot.call(() => registerCollisionAvoider.setCoordinationScale(harmonicDial), null);
    safePreBoot.call(() => verticalIntervalMonitor.setCoordinationScale(harmonicDial), null);

    // Rhythm phase/gravity: phase lock + temporal gravity + groove transfer
    const rhythmPhaseDial = dials['rhythm-phaseLockGravity'];
    safePreBoot.call(() => rhythmicPhaseLock.setCoordinationScale(rhythmPhaseDial), null);
    safePreBoot.call(() => temporalGravity.setCoordinationScale(rhythmPhaseDial), null);

    // Groove + convergence
    const grooveConvDial = dials['rhythm-grooveConvergence'];
    safePreBoot.call(() => grooveTransfer.setCoordinationScale(grooveConvDial), null);
    safePreBoot.call(() => convergenceDetector.setCoordinationScale(grooveConvDial), null);

    // Dynamics: envelope + velocity interference
    const dynamicsDial = dials['dynamics-envelopeInterference'];
    safePreBoot.call(() => crossLayerDynamicEnvelope.setCoordinationScale(dynamicsDial), null);
    safePreBoot.call(() => velocityInterference.setCoordinationScale(dynamicsDial), null);

    // Dynamics: articulation + texture
    const artTexDial = dials['dynamics-articulationTexture'];
    safePreBoot.call(() => articulationComplement.setCoordinationScale(artTexDial), null);
    safePreBoot.call(() => texturalMirror.setCoordinationScale(artTexDial), null);

    // Motif echo: coordinated = more imitative counterpoint, independent = original material
    const motifDial = dials['motif-echoIdentity'];
    safePreBoot.call(() => motifEcho.setCoordinationScale(motifDial), null);

    // Structure: trust + negotiation
    const trustDial = dials['structure-trustNegotiation'];
    safePreBoot.call(() => adaptiveTrustScores.setCoordinationScale(trustDial), null);
    safePreBoot.call(() => negotiationEngine.setCoordinationScale(trustDial), null);
  }

  /**
   * Get the current coordination dial for a module pair.
   * @param {string} pair
   * @returns {number} 0-1
   */
  function getDial(pair) {
    return dials[pair] !== undefined ? dials[pair] : 0.5;
  }

  function setOscillationMode(enabled) { oscillationEnabled = Boolean(enabled); oscillationBeat = 0; }

  function setChaosMode(enabled) {
    const target = enabled ? 0.1 : 0.5;
    for (let i = 0; i < MODULE_PAIRS.length; i++) {
      dials[MODULE_PAIRS[i]] = target;
      beatsSinceChange[MODULE_PAIRS[i]] = 0;
    }
    applyDials();
  }

  function getSnapshot() {
    return {
      dials: Object.assign({}, dials),
      targets: Object.assign({}, dialTargets),
      effectiveness: Object.assign({}, effectiveness),
      tickCount
    };
  }

  function reset() {
    for (let i = 0; i < MODULE_PAIRS.length; i++) {
      const pair = MODULE_PAIRS[i];
      dials[pair] = 0.5;
      dialTargets[pair] = 0.5;
      beatsSinceChange[pair] = 0;
      effectiveness[pair] = 0.5;
      healthAtLastChange[pair] = 0.7;
    }
    tickCount = 0;
  }

  return { tick, getDial, setChaosMode, setOscillationMode, getSnapshot, reset };
})();
crossLayerRegistry.register('coordinationIndependenceManager', coordinationIndependenceManager, ['all', 'section']);
