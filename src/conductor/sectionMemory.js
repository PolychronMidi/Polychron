// sectionMemory.js - Cross-section narrative memory.
// Snapshots key conductor state before section reset and seeds
// the next section with attenuated carryover. Prevents cold-start
// amnesia where each section restarts from a blank slate.

sectionMemory = (() => {
  const CARRYOVER = 0.30; // fraction of previous state seeded into new section

  /** @type {{ energy: number, tension: number, density: number, flicker: number, trend: string } | null} */
  let _prev = null;

  /**
   * Snapshot current conductor state before section reset.
   * Call from main.js immediately before crossLayerLifecycleManager.resetSection().
   */
  function snapshot() {
    const mom = energyMomentumTracker.getMomentum();
    _prev = {
      energy: clamp(conductorState.getField('compositeIntensity') || 0.5, 0, 1),
      tension: clamp(signalReader.tension(), 0.4, 1.6),
      density: clamp(currentDensity, 0, 1),
      flicker: clamp(signalReader.flicker(), 0.4, 1.6),
      trend: mom.trend || 'steady'
    };
  }

  /**
   * Seed the new section with attenuated state from the previous section.
   * Call from main.js immediately after section reset + harmonicJourney.applyToContext().
   * Only affects `currentDensity` (writable global) - other modules
   * pick up the seeded density naturally through their EMA/recorder paths.
   */
  function seed() {
    if (!_prev) return;
    // Blend previous density into the freshly-reset currentDensity
    currentDensity = currentDensity * (1 - CARRYOVER) + _prev.density * CARRYOVER;
  }

  /**
   * Get the previous section's snapshot for diagnostic and conductor advisory use.
   * @returns {{ energy: number, tension: number, density: number, flicker: number, trend: string } | null}
   */
  function getPrevious() {
    return _prev ? Object.assign({}, _prev) : null;
  }

  function reset() {
    _prev = null;
  }

  return { snapshot, seed, getPrevious, reset };
})();
