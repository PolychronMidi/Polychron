// sectionMemory.js - Cross-section narrative memory.
// Snapshots key conductor state before section reset and seeds
// the next section with attenuated carryover. Prevents cold-start
// amnesia where each section restarts from a blank slate.

sectionMemory = (() => {
  const V = validator.create('sectionMemory');
  const CARRYOVER = 0.30; // fraction of previous state seeded into new section

  /** @type {{ energy: number, tension: number, density: number, flicker: number, trend: string, regime?: string, coherenceBias?: number, intentDensity?: number, intentTension?: number, regimeTransitionCount?: number, lastTransitionCause?: string|null, spectralBrightness?: number } | null} */
  let sectionMemoryPrev = null;
  /** @type {number[]} rolling tension history across sections */
  const tensionHistory = [];
  /** @type {number[]} rolling density history across sections */
  const densityHistory = [];

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
      intentTension: lastIntent.dissonanceTarget,
      regimeTransitionCount: L0.count('regimeTransition', { since: beatStartTime - 60, windowSeconds: 60 }),
      lastTransitionCause: (() => { const rt = L0.getLast('regimeTransition', {}); return rt && rt.cause ? rt.cause : null; })(),
      spectralBrightness: (() => { const ctx = FactoryManager.sharedPhraseArcManager.getPhraseContext(); return ctx && Number.isFinite(ctx.spectralDensity) ? ctx.spectralDensity : 0.5; })()
    };
    tensionHistory.push(sectionMemoryPrev.tension);
    densityHistory.push(sectionMemoryPrev.density);
    if (tensionHistory.length > 8) tensionHistory.shift();
    if (densityHistory.length > 8) densityHistory.shift();
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

  /**
   * Get the tension trajectory slope across recent sections.
   * Negative = tension has been declining, positive = rising.
   * @returns {number} slope (-1 to 1)
   */
  function getTensionTrajectory() {
    if (tensionHistory.length < 2) return 0;
    const n = tensionHistory.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += tensionHistory[i];
      sumXY += i * tensionHistory[i]; sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    return denom < 1e-10 ? 0 : clamp((n * sumXY - sumX * sumY) / denom, -1, 1);
  }

  function getDensityTrajectory() {
    if (densityHistory.length < 2) return 0;
    const n = densityHistory.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += densityHistory[i];
      sumXY += i * densityHistory[i]; sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    return denom < 1e-10 ? 0 : clamp((n * sumXY - sumX * sumY) / denom, -1, 1);
  }

  function reset() {
    sectionMemoryPrev = null;
    tensionHistory.length = 0;
    densityHistory.length = 0;
  }

  function getHistory() {
    return { tension: tensionHistory.slice(), density: densityHistory.slice() };
  }

  return { snapshot, seed, getPrevious, getTensionTrajectory, getDensityTrajectory, getHistory, reset };
})();
