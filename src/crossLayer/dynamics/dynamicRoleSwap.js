// src/crossLayer/dynamicRoleSwap.js - Periodic layer behavioral profile swap.
// Every N phrases, the two layers swap behavioral profiles: dense - sparse,
// melodic - chordal, etc. Driven by conductorState intensity - swaps happen
// at tension valleys for natural transitions.

dynamicRoleSwap = (() => {
  const V = validator.create('dynamicRoleSwap');
  const MIN_PHRASES_BETWEEN_SWAPS = 2;
  const TENSION_VALLEY_THRESHOLD = 0.45; // R34 E4: 0.3->0.45 allow swaps during moderate tension valleys (was never triggering at 0.3 with avg tension 0.5-0.7)
  const SWAP_PROBABILITY = 0.75; // probability of actually swapping when conditions met
  const SWAP_DROUGHT_TRIGGER = 4;
  const MODERATE_TENSION_THRESHOLD = 0.62;
  const DROUGHT_SWAP_PROBABILITY = 0.55;
  const SWAPPED_L2_WINDOW_SECONDS = 12;
  const SWAPPED_L2_IMBALANCE_OFFSET = 4;
  const SWAPPED_L2_IMBALANCE_RANGE = 18;
  const SWAPPED_L2_MAX_RELIEF = 0.32;

  let phrasesSinceLastSwap = 0;
  let swapCount = 0;
  let isSwapped = false;

  /**
   * Called at each phrase boundary to evaluate whether a swap should occur.
   * @param {number} absTimeMs - current absolute ms
   * @param {number} currentTension - 0-1 normalized tension from conductorState
   * @returns {{ swapped: boolean, swapCount: number }}
   */
  function evaluateSwap(absTimeMs, currentTension) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(currentTension, 'currentTension');
    phrasesSinceLastSwap++;

    // Not enough time since last swap
    if (phrasesSinceLastSwap < MIN_PHRASES_BETWEEN_SWAPS) {
      return { swapped: false, swapCount };
    }
    const inValley = currentTension <= TENSION_VALLEY_THRESHOLD;
    const droughtRelease = phrasesSinceLastSwap >= SWAP_DROUGHT_TRIGGER && currentTension <= MODERATE_TENSION_THRESHOLD;
    if (!inValley && !droughtRelease) {
      return { swapped: false, swapCount };
    }
    // R90 E4: Regime-responsive swap probability. Exploring passages benefit
    // from more frequent layer swaps (richer cross-layer dynamic interplay),
    // while coherent passages keep swaps rare to preserve musical stability.
    const regime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'initializing');
    const regimeSwapScale = regime === 'exploring' ? 1.15
      : regime === 'coherent' ? 0.80
      : 1.0; // evolving / initializing
    const gate = clamp((inValley ? SWAP_PROBABILITY : DROUGHT_SWAP_PROBABILITY) * regimeSwapScale, 0, 1);
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
    const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
    const lowPhasePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
    const imbalancePressure = clamp((recentL2Count - recentL1Count - SWAPPED_L2_IMBALANCE_OFFSET) / SWAPPED_L2_IMBALANCE_RANGE, 0, 1) * (1 - lowPhasePressure * 0.65);
    return {
      densityScale: 1.4 - imbalancePressure * SWAPPED_L2_MAX_RELIEF,
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
  }

  return { evaluateSwap, getProfileModifiers, modifyPlayProb, modifyVelocity, getIsSwapped, getSwapCount, reset };
})();
crossLayerRegistry.register('dynamicRoleSwap', dynamicRoleSwap, ['all']);
