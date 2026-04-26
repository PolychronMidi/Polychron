// src/crossLayer/stutterContagion.js - Cross-layer stutter infection via ATG.
// When one layer stutters, the other layer picks up a complementary stutter
// at the same ms-derived tick with decaying intensity.

/**
 * @typedef {{
 *   intensity: number,
 *   channels: number[],
 *   type: string
 * }} ContagionPayload
 */

moduleLifecycle.declare({
  name: 'stutterContagion',
  subsystem: 'crossLayer',
  deps: ['L0', 'stutterVariants', 'validator'],
  lazyDeps: ['crossLayerHelpers', 'emergentMelodicEngine', 'rhythmicPhaseLock'],
  provides: ['stutterContagion'],
  crossLayerScopes: ['all'],
  init: (deps) => {
  const L0 = deps.L0;
  const stutterVariants = deps.stutterVariants;
  const V = deps.validator.create('stutterContagion');
  const STUTTER_TYPES = new Set(['fade', 'pan', 'fx']);
  const SYNC_TOLERANCE_MS = 150;
  const BASE_DECAY = 0.6;
  const ALIGNED_DECAY = 0.35; // tighter decay = stickier when converged
  const DIVERGED_DECAY = 0.8;  // looser decay = fades faster when divergent
  const CONVERGENCE_WINDOW_MS = 2000; // look for recent convergences within this window
  const CHANNEL = 'stutterContagion';
  let cimScale = 0.5;

  /**
   * Compute adaptive decay factor based on recent convergence state.
   * @param {number} absoluteSeconds
   * @returns {number} decay factor (lower = stickier)
   */
  function getAdaptiveDecay(absoluteSeconds) {
    // Check if convergence happened recently via ATG onset channel
    const recentConvergence = L0.findClosest(L0_CHANNELS.onset, absoluteSeconds, CONVERGENCE_WINDOW_MS / 1000
    );
    if (!recentConvergence) return BASE_DECAY;
    const dist = m.abs(recentConvergence.timeInSeconds - absoluteSeconds);
    const recency = 1 - (dist / (CONVERGENCE_WINDOW_MS / 1000));
    // Interpolate: recent convergence - ALIGNED (sticky), distant - DIVERGED (loose)
    const baseResult = BASE_DECAY + recency * (ALIGNED_DECAY - BASE_DECAY) + (1 - recency) * (DIVERGED_DECAY - BASE_DECAY) * 0.3;
    // Tempo modulation: faster tempo = tighter decay, slower = more lingering
    const sctLayer = (LM && LM.activeLayer) ? LM.activeLayer : 'L1';
    const tempoEntry = L0.getLast(L0_CHANNELS.tickDuration, { layer: sctLayer });
    const bpmScale = tempoEntry && Number.isFinite(tempoEntry.bpmScale) ? tempoEntry.bpmScale : 1.0;
    // Rhythmic coupling: dense emergent rhythm = stickier contagion (lower decay).
    // When the cross-layer rhythm grid is busy, stutter infection propagates more readily.
    const rhythmEntry = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const rhythmDensity = rhythmEntry && Number.isFinite(rhythmEntry.density) ? rhythmEntry.density : 0;
    const rhythmDecayMod = 1.0 - rhythmDensity * 0.12; // [0.88-1.0] dense->sticky
    return baseResult * clamp(0.8 + bpmScale * 0.2, 0.85, 1.15) * rhythmDecayMod;
  }

  /**
   * Post a stutter event from the active layer into ATG.
   * Call this after any stutter fires in the main loop.
   * @param {number} absoluteSeconds - absolute ms
   * @param {string} layer - source layer
   * @param {number} intensity - 0-1 normalized stutter intensity
   * @param {number[]} channels - MIDI channels that stuttered
   * @param {string} type - 'fade' | 'pan' | 'fx'
   */
  function postStutter(absoluteSeconds, layer, intensity, channels, type) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(layer, 'layer');
    const normalizedIntensity = clamp(V.requireFinite(intensity, 'intensity'), 0, 1);
    const normalizedChannels = V.assertArray(channels, 'channels');
    for (let i = 0; i < normalizedChannels.length; i++) {
      V.requireFinite(normalizedChannels[i], `channels[${i}]`);
    }
    const normalizedType = V.assertInSet(type, STUTTER_TYPES, 'type');
    L0.post(CHANNEL, layer, absoluteSeconds, {
      intensity: normalizedIntensity,
      channels: normalizedChannels,
      type: normalizedType
    });
  }

  /**
   * Check for cross-layer stutter infection. Returns null if no infection
   * should happen, otherwise returns the contagion parameters.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ syncOffset: number, intensity: number, channels: number[], type: string } | null}
   */
  function checkContagion(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const match = L0.findClosest(
      CHANNEL, absoluteSeconds, SYNC_TOLERANCE_MS / 1000, activeLayer
    );
    if (!match) return null;
    V.assertObject(match, 'checkContagion.match');
    const matchIntensity = V.requireFinite(match.intensity, 'checkContagion.match.intensity');
        const matchChannels = V.assertArray(match.channels, 'checkContagion.match.channels');
    for (let i = 0; i < matchChannels.length; i++) {
      V.requireFinite(matchChannels[i], `checkContagion.match.channels[${i}]`);
    }
    const matchType = V.assertInSet(match.type, STUTTER_TYPES, 'checkContagion.match.type');

    // CIM: coordinated = stickier contagion, independent = faster decay
    const decay = getAdaptiveDecay(absoluteSeconds) * (1.3 - cimScale * 0.6);
    const decayedIntensity = matchIntensity * decay;
    if (decayedIntensity < 0.05) return null;

    // R58: melodic context gates contagion. High thematic density -> reduce (motif echo
    // already provides rhythmic "infection"). Stale intervals -> boost (rhythmic novelty).
    // Contrary counterpoint -> slight boost (opposing motion benefits from interruption).
    const melodicCtxSC = emergentMelodicEngine.getContext();
    // R77: ascendRatio bridge -- ascending melodic energy intensifies cross-layer stutter spread
    const melodicContagionScale = melodicCtxSC
      ? clamp(1.0 - melodicCtxSC.thematicDensity * 0.20
        + (melodicCtxSC.intervalFreshness < 0.40 ? 0.10 : 0)
        + (melodicCtxSC.counterpoint === 'contrary' ? 0.08 : 0)
        + (melodicCtxSC.ascendRatio > 0.55 ? (melodicCtxSC.ascendRatio - 0.55) * 0.30 : 0), 0.65, 1.35)
      : 1.0;
    // R78: phase-lock coupling -- locked layers stutter together (synchronized burst = rhythmic unison),
    // repelling layers diverge (opposition should not cascade stutter across layers).
    const phaseModeContagion = rhythmicPhaseLock.getMode();
    const phaseContagionScale = phaseModeContagion === 'lock' ? 1.12 : phaseModeContagion === 'repel' ? 0.88 : 1.0;
    // R79 E4: densitySurprise antagonism bridge with restSynchronizer -- surprising rhythmic events
    // amplify contagion spread (chaos invites more chaos). Counterpart: restSynchronizer SUPPRESSES
    // rests on same signal (surprise = no breathing room, both layers in contagion state).
    const rhythmEntrySC = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const densitySurpriseSC = rhythmEntrySC && Number.isFinite(rhythmEntrySC.densitySurprise) ? rhythmEntrySC.densitySurprise : 1.0;
    const surpriseContagionScale = densitySurpriseSC > 1.1 ? 1.0 + clamp((densitySurpriseSC - 1.0) * 0.12, 0, 0.10) : 1.0;
    // R82 E4: tessituraLoad bridge -- extreme register amplifies stutter contagion
    // (chaos diversifies at register extremes). Counterpart: harmonicIntervalGuard TIGHTENS
    // harmonic control under same signal (structure anchors at extremes).
    const tessituraContagionSC = melodicCtxSC ? V.optionalFinite(melodicCtxSC.tessituraLoad, 0) : 0;
    const tessituraContagionScale = 1.0 + clamp(tessituraContagionSC * 0.15, 0, 0.12);
    // R88 E2: complexityEma antagonism bridge with grooveTransfer -- sustained rhythmic complexity
    // amplifies stutter contagion (complex texture propagates chaos more aggressively).
    // Counterpart: grooveTransfer REDUCES transfer under same signal (groove stability anchors complexity).
    const complexityEmaSC = rhythmEntrySC && Number.isFinite(rhythmEntrySC.complexityEma) ? rhythmEntrySC.complexityEma : 0.5;
    const complexityContagionScale = 1.0 + clamp((complexityEmaSC - 0.45) * 0.20, -0.04, 0.10);
    // contourShape: rising arc = stutter infection spreads harder (ascending energy amplifies chaos cascade);
    // falling arc = contagion softens (descent = release phase, stutter settles rather than spreads).
    const contourContagionSC = melodicCtxSC
      ? (melodicCtxSC.contourShape === 'rising' ? 1.07 : melodicCtxSC.contourShape === 'falling' ? 0.93 : 1.0)
      : 1.0;
    const gatedIntensity = decayedIntensity * melodicContagionScale * phaseContagionScale * surpriseContagionScale * tessituraContagionScale * complexityContagionScale * contourContagionSC;
    if (gatedIntensity < 0.05) return null;

    // Convert the source stutter's ms to this layer's tick space
    const syncOffset = crossLayerHelpers.syncOffset(match.timeInSeconds);

    return {
      syncOffset,
      intensity: gatedIntensity,
      channels: matchChannels,
      type: matchType
    };
  }

  /**
   * Apply stutter contagion: triggers a secondary stutter on the receiving layer.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   */
  function apply(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const contagion = checkContagion(absoluteSeconds, activeLayer);
    if (!contagion) return;

    // Scale stutter parameters by decayed intensity
    const numStutters = m.max(5, m.round(ri(10, 70) * contagion.intensity));
    const duration = spBeat * rf(.1, .8) * contagion.intensity;

    if (contagion.type === 'fade' && stutterFade) {
      stutterFade(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'pan' && stutterPan) {
      stutterPan(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'fx' && stutterFX) {
      stutterFX(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    }

    // Contagion note stutter: force ghostStutter variant (most reductive)
    // to prevent dense variant cascades across layers
    const ghostFn = stutterVariants.getVariant('ghostStutter');
    if (ghostFn && contagion.intensity > 0.15) {
      const savedVariant = stutterRegistry.getHelper();
      stutterRegistry.registerHelper(ghostFn);
      const chs = flipBin ? flipBinT3 : flipBinF3;
      if (chs.length > 0) {
        const ch = chs[ri(chs.length - 1)];
        const lastNote = L0.getLast(L0_CHANNELS.note, { layer: activeLayer });
        if (lastNote && Number.isFinite(lastNote.midi)) {
          StutterManager.scheduleStutterForUnit({
            profile: 'reflection', channel: ch,
            note: lastNote.midi, on: absoluteSeconds,
            sustain: duration, velocity: clamp(m.round(40 * contagion.intensity), 10, 40),
            binVel: clamp(m.round(40 * contagion.intensity), 10, 40), isPrimary: false
          });
        }
      }
      stutterRegistry.registerHelper(savedVariant);
    }

    // Re-post with decayed intensity to sustain the chain across more layers
    const repostDecay = getAdaptiveDecay(absoluteSeconds);
    L0.post(CHANNEL, activeLayer, absoluteSeconds, {
      intensity: contagion.intensity * repostDecay,
      channels: contagion.channels,
      type: contagion.type
    });
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  return { postStutter, checkContagion, apply, setCoordinationScale, reset() { cimScale = 0.5; } };
  },
});
