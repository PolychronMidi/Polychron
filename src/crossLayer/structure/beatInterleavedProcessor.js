// @ts-check

/**
 * Beat-Interleaved Layer Processor (E9)
 *
 * Provides a helper that enables cross-layer awareness during beat
 * processing. Rather than a full architectural refactor of layerPass,
 * this module records per-layer beat outcomes and provides a
 * "shadow context" so the second layer processed in a beat can see
 * what the first layer did.
 *
 * API:
 *   beatInterleavedProcessor.recordLayerBeat(layer, outcome)
 *   beatInterleavedProcessor.getOtherLayerOutcome(layer) → outcome | null
 *   beatInterleavedProcessor.reset()
 *
 * Registered as a cross-layer module with phrase scope.
 */

beatInterleavedProcessor = (() => {
  const V = validator.create('beatInterleavedProcessor');

  /** @type {Map<number, object>} */
  let currentBeatOutcomes = new Map();
  let beatId = -1;

  /**
   * Record what a layer emitted during the current beat.
   * @param {number} layer  1 or 2
   * @param {object} outcome  { notesEmitted, avgPitch, avgVelocity, ... }
   */
  function recordLayerBeat(layer, outcome) {
    const b = V.optionalFinite(beatCount, -1);
    if (b !== beatId) {
      currentBeatOutcomes = new Map();
      beatId = b;
    }
    currentBeatOutcomes.set(layer, outcome);
  }

  /**
   * Get what the other layer did this beat (or null if not yet processed).
   * @param {number} myLayer  1 or 2
   * @returns {object|null}
   */
  function getOtherLayerOutcome(myLayer) {
    const other = myLayer === 1 ? 2 : 1;
    return currentBeatOutcomes.get(other) || null;
  }

  /**
   * Get both outcomes for the current beat.
   */
  function getBeatSnapshot() {
    return {
      layer1: currentBeatOutcomes.get(1) || null,
      layer2: currentBeatOutcomes.get(2) || null,
    };
  }

  function reset() {
    currentBeatOutcomes = new Map();
    beatId = -1;
  }

  const mod = { recordLayerBeat, getOtherLayerOutcome, getBeatSnapshot, reset };

  crossLayerRegistry.register('beatInterleavedProcessor', mod, ['all', 'phrase']);

  return mod;
})();
