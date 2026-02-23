// src/crossLayer/dynamicRoleSwap.js — Periodic layer behavioral profile swap.
// Every N phrases, the two layers swap behavioral profiles: dense → sparse,
// melodic → chordal, etc. Driven by ConductorState intensity — swaps happen
// at tension valleys for natural transitions.

DynamicRoleSwap = (() => {
  const V = Validator.create('dynamicRoleSwap');
  const MIN_PHRASES_BETWEEN_SWAPS = 3;
  const TENSION_VALLEY_THRESHOLD = 0.3; // only swap when tension is low
  const SWAP_PROBABILITY = 0.6; // probability of actually swapping when conditions met

  let phrasesSinceLastSwap = 0;
  let swapCount = 0;
  let isSwapped = false;

  /**
   * Called at each phrase boundary to evaluate whether a swap should occur.
   * @param {number} absTimeMs - current absolute ms
   * @param {number} currentTension - 0-1 normalized tension from ConductorState
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
    // Only swap in tension valleys
    if (currentTension > TENSION_VALLEY_THRESHOLD) {
      return { swapped: false, swapCount };
    }
    // Probabilistic gate
    if (rf() > SWAP_PROBABILITY) {
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
    return { densityScale: 1.4, chordalBias: -0.2, melodicBias: 0.3, isSwapped: true };
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
    return Math.round(clamp(vel * scale, 1, MIDI_MAX_VALUE));
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
CrossLayerRegistry.register('DynamicRoleSwap', DynamicRoleSwap, ['all']);
