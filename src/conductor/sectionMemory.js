// sectionMemory.js - Cross-section narrative memory.
// Snapshots key conductor state before section reset and seeds
// the next section with attenuated carryover. Prevents cold-start
// amnesia where each section restarts from a blank slate.

sectionMemory = (() => {
  const V = validator.create('sectionMemory');
  const CARRYOVER = 0.30; // fraction of previous state seeded into new section

  /** @type {{ energy: number, tension: number, density: number, flicker: number, trend: string, regime?: string, coherenceBias?: number, intentDensity?: number, intentTension?: number } | null} */
  let sectionMemoryPrev = null;

  /**
   * Snapshot current conductor state before section reset.
   * Call from main.js immediately before crossLayerLifecycleManager.resetSection().
   */
  function snapshot() {
    const mom = energyMomentumTracker.getMomentum();
    const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const coherenceBias = V.optionalFinite(coherenceMonitor.getDensityBias(), 1.0);
    const lastIntent = sectionIntentCurves.getLastIntent();
    sectionMemoryPrev = {
      energy: clamp(V.optionalFinite(conductorState.getField('compositeIntensity'), 0.5), 0, 1),
      tension: clamp(signalReader.tension(), 0.4, 1.6),
      density: clamp(currentDensity, 0, 1),
      flicker: clamp(signalReader.flicker(), 0.4, 1.6),
      trend: mom.trend ? mom.trend : 'steady',
      regime: snap ? snap.regime : 'evolving',
      coherenceBias,
      intentDensity: lastIntent.densityTarget,
      intentTension: lastIntent.dissonanceTarget
    };
  }

  /**
   * Seed the new section with attenuated state from the previous section.
   * Call from main.js immediately after section reset + harmonicJourney.applyToContext().
   * Only affects `currentDensity` (writable global) - other modules
   * pick up the seeded density naturally through their EMA/recorder paths.
   */
  function seed() {
    if (!sectionMemoryPrev) return;
    // Blend previous density into the freshly-reset currentDensity
    currentDensity = currentDensity * (1 - CARRYOVER) + sectionMemoryPrev.density * CARRYOVER;
  }

  /**
   * Get the previous section's snapshot for diagnostic and conductor advisory use.
   * @returns {{ energy: number, tension: number, density: number, flicker: number, trend: string } | null}
   */
  function getPrevious() {
    return sectionMemoryPrev ? Object.assign({}, sectionMemoryPrev) : null;
  }

  function reset() {
    sectionMemoryPrev = null;
  }

  return { snapshot, seed, getPrevious, reset };
})();
