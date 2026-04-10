// src/crossLayer/dynamicRoleSwap.js - Periodic layer behavioral profile swap.
// Every N phrases, the two layers swap behavioral profiles: dense - sparse,
// melodic - chordal, etc. Driven by conductorState intensity - swaps happen
// at tension valleys for natural transitions.

dynamicRoleSwap = (() => {
  const V = validator.create('dynamicRoleSwap');
  const MIN_PHRASES_BETWEEN_SWAPS = 2;
  const TENSION_VALLEY_THRESHOLD = 0.45; // absolute floor: obvious valleys still trigger regardless of regime
  const SWAP_PROBABILITY = 0.75; // probability of actually swapping when conditions met
  const SWAP_DROUGHT_TRIGGER = 4;
  const MODERATE_TENSION_THRESHOLD = 0.62; // absolute floor for drought release
  const DROUGHT_SWAP_PROBABILITY = 0.55;
  // Tension EMA: relative valley detection so thresholds track actual composition tension level
  const TENSION_EMA_ALPHA = 0.08;
  const TENSION_VALLEY_RELATIVE_DROP = 0.12; // inValley if tension < ema - this
  const DROUGHT_RELATIVE_DROP = 0.07; // drought release if tension < ema - this
  const SWAPPED_L2_WINDOW_SECONDS = 12;
  const SWAPPED_L2_IMBALANCE_OFFSET = 4;
  const SWAPPED_L2_IMBALANCE_RANGE = 18;
  const SWAPPED_L2_MAX_RELIEF = 0.32;

  let phrasesSinceLastSwap = 0;
  let swapCount = 0;
  let isSwapped = false;
  let tensionEma = 0.5;

  /**
   * Called at each phrase boundary to evaluate whether a swap should occur.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {number} currentTension - 0-1 normalized tension from conductorState
   * @returns {{ swapped: boolean, swapCount: number }}
   */
  function evaluateSwap(absoluteSeconds, currentTension) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.requireFinite(currentTension, 'currentTension');
    phrasesSinceLastSwap++;
    tensionEma = tensionEma + TENSION_EMA_ALPHA * (currentTension - tensionEma);

    // Not enough time since last swap
    if (phrasesSinceLastSwap < MIN_PHRASES_BETWEEN_SWAPS) {
      return { swapped: false, swapCount };
    }
    // Relative valley: below running EMA by threshold, or absolute floor
    const inValley = currentTension <= tensionEma - TENSION_VALLEY_RELATIVE_DROP || currentTension <= TENSION_VALLEY_THRESHOLD;
    const droughtRelease = phrasesSinceLastSwap >= SWAP_DROUGHT_TRIGGER && (currentTension <= tensionEma - DROUGHT_RELATIVE_DROP || currentTension <= MODERATE_TENSION_THRESHOLD);
    if (!inValley && !droughtRelease) {
      return { swapped: false, swapCount };
    }
    // R90 E4: Regime-responsive swap probability. Exploring passages benefit
    // from more frequent layer swaps (richer cross-layer dynamic interplay),
    // while coherent passages keep swaps rare to preserve musical stability.
    const regime = regimeClassifier.getLastRegime();
    const regimeSwapScale = regime === 'exploring' ? 1.15
      : regime === 'coherent' ? 0.80
      : 1.0;
    // Regime transition recency boost: recent transition = natural swap moment
    const recentTransition = L0.getLast('regimeTransition', { since: absoluteSeconds - 2, windowSeconds: 2 });
    const transitionBoost = recentTransition ? 0.15 : 0;
    // Active feedback loops = more cross-layer conversation = natural swap point
    const feedbackCount = L0.count('feedbackLoop', { since: absoluteSeconds - 4, windowSeconds: 4 });
    const feedbackBoost = feedbackCount > 3 ? 0.1 : 0;
    // Melodic coupling: contourShape modulates swap gate.
    // Falling contour -> natural role handoff moment -> amplify gate.
    // Rising contour -> keep the build going with current roles -> suppress gate.
    const melodicCtxDRS = emergentMelodicEngine.getContext();
    const contourSwapBoost = melodicCtxDRS
      ? (melodicCtxDRS.contourShape === 'falling' ? 0.08 : melodicCtxDRS.contourShape === 'rising' ? -0.08 : 0)
      : 0;
    // Rhythmic coupling: strong emergent rhythm structure (high biasStrength) = natural role exchange moment.
    const rhythmEntryDRS = L0.getLast('emergentRhythm', { layer: 'both' });
    const rhythmBiasBoost = rhythmEntryDRS && Number.isFinite(rhythmEntryDRS.biasStrength) && rhythmEntryDRS.biasStrength > 0.4 ? 0.06 : 0;
    // R75: registerMigrationDir antagonism bridge -- ascending pitch center = more frequent role swaps (dynamic reorganization as range expands).
    const registerSwapBoostDRS = melodicCtxDRS ? (melodicCtxDRS.registerMigrationDir === 'ascending' ? 0.04 : melodicCtxDRS.registerMigrationDir === 'descending' ? -0.05 : 0) : 0;
    // R81 E1: complexityEma antagonism bridge with climaxEngine -- sustained high complexity
    // lowers swap threshold (dynamics reorganize into new roles as long-term complexity accumulates).
    // Counterpart: climaxEngine SUPPRESSES approach at same complexityEma (E2). Together:
    // dynamics reshuffles while structural arc holds -- complexityEma is the shared currency.
    const complexityEmaDRS = rhythmEntryDRS && Number.isFinite(rhythmEntryDRS.complexityEma) ? rhythmEntryDRS.complexityEma : 0.5;
    const complexityEmaSwapBoost = clamp((complexityEmaDRS - 0.50) * 0.14, -0.05, 0.08);
    // R84 E2: per-beat complexity bridge -- instantaneous complexity spikes lower swap gate
    // (role swaps at complex beats, faster than complexityEma's slow memory).
    // Counterpart: verticalIntervalMonitor RAISES collision penalty under same signal.
    const complexityBeatDRS = rhythmEntryDRS && Number.isFinite(rhythmEntryDRS.complexity) ? rhythmEntryDRS.complexity : 0.5;
    const complexityBeatSwapBoost = clamp((complexityBeatDRS - 0.55) * 0.10, -0.03, 0.06);
    // R85 E2: intervalFreshness antagonism bridge -- novel intervals trigger more dynamic role reshuffling.
    // Counterpart: temporalGravity STRENGTHENS gravity wells under same signal (temporal pull tightens as roles shuffle).
    const intervalFreshnessSwapBoost = melodicCtxDRS
      ? clamp((V.optionalFinite(melodicCtxDRS.intervalFreshness, 0.5) - 0.45) * 0.10, -0.02, 0.05)
      : 0;
    // R89 E1: freshnessEma antagonism bridge with verticalIntervalMonitor -- sustained melodic novelty
    // amplifies role-swap frequency (novel melodic territory = dynamic reorganization needed).
    // Counterpart: verticalIntervalMonitor REDUCES collision penalty under same signal (harmonic exploration endorsed).
    const freshnessEmaDRS = melodicCtxDRS ? V.optionalFinite(melodicCtxDRS.freshnessEma, 0.5) : 0.5;
    const freshnessEmaSwapBoost = clamp((freshnessEmaDRS - 0.45) * 0.08, -0.02, 0.035);
    const gate = clamp((inValley ? SWAP_PROBABILITY : DROUGHT_SWAP_PROBABILITY) * regimeSwapScale + transitionBoost + feedbackBoost + contourSwapBoost + rhythmBiasBoost + registerSwapBoostDRS + complexityEmaSwapBoost + complexityBeatSwapBoost + intervalFreshnessSwapBoost + freshnessEmaSwapBoost, 0, 1);
    if (rf() > gate) {
      return { swapped: false, swapCount };
    }

    // Execute swap
    isSwapped = !isSwapped;
    swapCount++;
    phrasesSinceLastSwap = 0;

    return { swapped: true, swapCount };
  }

  /**
   * Get the effective behavioral profile modifiers for a given layer.
   * When swapped, L1 gets L2-style modifiers and vice versa.
   * @param {string} layer - 'L1' or 'L2'
   * @returns {{ densityScale: number, chordalBias: number, melodicBias: number, isSwapped: boolean }}
   */
  function getProfileModifiers(layer) {
    if (!isSwapped) {
      return {
        densityScale: 1.0,
        chordalBias: layer === 'L1' ? 0 : 0,
        melodicBias: 0,
        isSwapped: false
      };
    }
    // When swapped: invert the typical density/chordal/melodic biases
    if (layer === 'L1') {
      // L1 takes on L2 characteristics: sparser, more supportive
      return { densityScale: 0.6, chordalBias: 0.3, melodicBias: -0.2, isSwapped: true };
    }
    // L2 takes on L1 characteristics: denser, more melodic
    const recentL2Count = L0.count('note', { layer: 'L2', windowSeconds: SWAPPED_L2_WINDOW_SECONDS });
    const recentL1Count = L0.count('note', { layer: 'L1', windowSeconds: SWAPPED_L2_WINDOW_SECONDS });
    const axisEnergyShares = conductorSignalBridge.getSignals().axisEnergyShares;
    const phaseShare = axisEnergyShares && typeof axisEnergyShares.phase === 'number'
      ? axisEnergyShares.phase
      : 1.0 / 6.0;
    const lowPhaseThreshold = V.optionalFinite(phaseFloorController.getLowShareThreshold(), 0);
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const imbalancePressure = clamp((recentL2Count - recentL1Count - SWAPPED_L2_IMBALANCE_OFFSET) / SWAPPED_L2_IMBALANCE_RANGE, 0, 1) * (1 - lowPhasePressure * 0.65);
    return {
      densityScale: 1.2 - imbalancePressure * SWAPPED_L2_MAX_RELIEF, // R19: 1.4 created 40% density surge driving density-phase exceedance; 1.2 = 20% boost max
      chordalBias: -0.2,
      melodicBias: 0.3 - imbalancePressure * 0.08,
      isSwapped: true
    };
  }

  /**
   * Apply role swap modifiers to a play probability.
   * @param {string} layer - 'L1' or 'L2'
   * @param {number} playProb - original play probability
   * @returns {number} modified play probability
   */
  function modifyPlayProb(layer, playProb) {
    const mods = getProfileModifiers(layer);
    return clamp(playProb * mods.densityScale, 0, 1);
  }

  /**
   * Apply role swap modifiers to a velocity.
   * @param {string} layer
   * @param {number} vel - original velocity
   * @returns {number} modified velocity
   */
  function modifyVelocity(layer, vel) {
    if (!isSwapped) return vel;
    // Swapped layers get slight velocity inversion
    const mods = getProfileModifiers(layer);
    const scale = 1 + mods.melodicBias * 0.15;
    return m.round(clamp(vel * scale, 1, MIDI_MAX_VALUE));
  }

  /** @returns {boolean} */
  function getIsSwapped() { return isSwapped; }

  /** @returns {number} */
  function getSwapCount() { return swapCount; }

  function reset() {
    phrasesSinceLastSwap = 0;
    swapCount = 0;
    isSwapped = false;
    tensionEma = 0.5;
  }

  return { evaluateSwap, getProfileModifiers, modifyPlayProb, modifyVelocity, getIsSwapped, getSwapCount, reset };
})();
crossLayerRegistry.register('dynamicRoleSwap', dynamicRoleSwap, ['all']);
