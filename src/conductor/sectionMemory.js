// sectionMemory.js - Cross-section narrative memory.
// Snapshots key conductor state before section reset and seeds
// the next section with attenuated carryover. Prevents cold-start
// amnesia where each section restarts from a blank slate.

sectionMemory = (() => {
  const V = validator.create('sectionMemory');
  const CARRYOVER = 0.30; // fraction of previous state seeded into new section

  /** @type {{ energy: number, tension: number, density: number, flicker: number, trend: string, regime?: string, coherenceBias?: number, intentDensity?: number, intentTension?: number, regimeTransitionCount?: number, lastTransitionCause?: string|null, spectralBrightness?: number, quality?: number } | null} */
  let sectionMemoryPrev = null;
  /** @type {number[]} rolling tension history across sections */
  const tensionHistory = [];
  /** @type {number[]} rolling density history across sections */
  const densityHistory = [];
  // R33: section quality scoring -- self-evaluating cross-section learning.
  // Tracks coupling stability, exceedance rate, and regime coherence per section,
  // then feeds quality assessment into the next section's intent targets.
  /** @type {number[]} */
  const qualityHistory = [];
  const QUALITY_FEEDFORWARD_STRENGTH = 0.15;

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
    // R33: quality scoring -- coherent share + low exceedance + coupling stability = high quality
    const regimeBalance = snap && snap.regime === 'coherent' ? 0.8 : snap && snap.regime === 'evolving' ? 0.5 : 0.3;
    const coherenceQuality = clamp(coherenceBias, 0.5, 1.5) / 1.5;
    const transitionPenalty = clamp(1.0 - (sectionMemoryPrev.regimeTransitionCount || 0) * 0.08, 0.3, 1.0);
    const quality = clamp(regimeBalance * 0.4 + coherenceQuality * 0.3 + transitionPenalty * 0.3, 0, 1);
    qualityHistory.push(quality);
    if (qualityHistory.length > 8) qualityHistory.shift();
    sectionMemoryPrev.quality = quality;
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
    // R33: quality feed-forward via L0 channel (conductor can't write to crossLayer directly).
    // sectionIntentCurves reads this to adjust targets for the next section.
    if (typeof sectionMemoryPrev.quality === 'number') {
      const qualityGap = 0.6 - sectionMemoryPrev.quality;
      if (qualityGap > 0.1) {
        L0.post('section-quality', 'both', beatStartTime, {
          quality: sectionMemoryPrev.quality,
          bias: qualityGap * QUALITY_FEEDFORWARD_STRENGTH
        });
      }
    }
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
