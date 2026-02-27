// src/conductor/rhythmic/interLayerRhythmAnalyzer.js - Unified cross-layer rhythm analysis.
// Merges CrossLayerRhythmPhaseTracker + MicroTimingDriftDetector +
// PolyrhythmicAlignmentTracker + MetricDisplacementDetector.
// Provides phase relationship, timing drift, alignment flicker, and hemiola detection.
// Pure query API - no side effects.

interLayerRhythmAnalyzer = (() => {
  // Beat-level caches - each analysis function is called 2+ times per beat
  // (once from flicker/bias registration, once from stateProvider).
  const _phaseCache = beatCache.create(() => interLayerRhythmHelpers.computePhaseRelationship());
  const _driftCache = beatCache.create(() => interLayerRhythmHelpers.computeDriftSignal());
  const _alignCache = beatCache.create(() => interLayerRhythmHelpers.computeAlignmentSignal());
  const _dispCache  = beatCache.create(() => interLayerRhythmHelpers.computeDisplacementProfile());

  /**
   * Phase relationship between L1 and L2 onsets (cached per beat for default window).
   * @param {number} [windowSeconds]
   * @returns {{ phase: string, coincidence: number, complementarity: number }}
   */
  function getPhaseRelationship(windowSeconds) {
    if (windowSeconds === undefined) return _phaseCache.get();
    return interLayerRhythmHelpers.computePhaseRelationship(windowSeconds);
  }

  /**
   * Suggest a rhythm phase strategy.
   * @param {string} layer
   * @returns {{ strategy: string, offsetBias: number }}
   */
  function suggestPhaseStrategy(layer) {
    const rel = getPhaseRelationship();
    if (rel.phase === 'in-phase') return { strategy: 'offset', offsetBias: 0.5 };
    if (rel.phase === 'complementary') return { strategy: 'maintain', offsetBias: 0 };
    if (rel.phase === 'counter-phase') return { strategy: 'converge', offsetBias: -0.3 };
    return { strategy: 'complement', offsetBias: layer === 'L2' ? 0.2 : 0 };
  }

  /**
   * Measure timing coherence between layers (cached per beat).
   * @returns {{ avgDrift: number, tightness: number, suggestion: string }}
   */
  function getDriftSignal() { return _driftCache.get(); }

  /**
   * Analyze layer alignment for convergence detection (cached per beat).
   * @returns {{ alignmentScore: number, convergencePoint: boolean, flickerMod: number }}
   */
  function getAlignmentSignal() { return _alignCache.get(); }

  /**
   * Get flicker modifier for the flickerAmplitude chain.
   * @returns {number}
   */
  function getFlickerModifier() {
    return getAlignmentSignal().flickerMod;
  }

  /**
   * Detect metric displacement and hemiola between layers (cached per beat for default window).
   * @param {number} [windowSeconds]
   * @returns {{ displacementRatio: number, hemiola: boolean, phaseOffset: number, intentional: boolean }}
   */
  function getDisplacementProfile(windowSeconds) {
    if (windowSeconds === undefined) return _dispCache.get();
    return interLayerRhythmHelpers.computeDisplacementProfile(windowSeconds);
  }

  /**
   * Signal displacement status for conductorState.
   * @returns {{ displacement: string, hemiolaActive: boolean }}
   */
  function getDisplacementSignal() {
    const profile = getDisplacementProfile();
    if (profile.hemiola) return { displacement: 'hemiola', hemiolaActive: true };
    if (profile.intentional) return { displacement: 'intentional', hemiolaActive: false };
    if (profile.displacementRatio > 0.3) return { displacement: 'accidental', hemiolaActive: false };
    return { displacement: 'aligned', hemiolaActive: false };
  }

  conductorIntelligence.registerFlickerModifier('interLayerRhythmAnalyzer', () => interLayerRhythmAnalyzer.getFlickerModifier(), 0.9, 1.2);
  conductorIntelligence.registerStateProvider('interLayerRhythmAnalyzer', () => {
    const disp = interLayerRhythmAnalyzer.getDisplacementSignal();
    const drift = interLayerRhythmAnalyzer.getDriftSignal();
    const phase = interLayerRhythmAnalyzer.getPhaseRelationship();
    const align = interLayerRhythmAnalyzer.getAlignmentSignal();
    return {
      metricDisplacement: disp.displacement,
      hemiolaActive: disp.hemiolaActive,
      timingTightness: drift.tightness,
      timingDriftSuggestion: drift.suggestion,
      rhythmPhase: phase.phase,
      rhythmCoincidence: phase.coincidence,
      rhythmComplementarity: phase.complementarity,
      polyrhythmConvergence: align.convergencePoint
    };
  });

  return {
    getPhaseRelationship,
    suggestPhaseStrategy,
    getDriftSignal,
    getAlignmentSignal,
    getFlickerModifier,
    getDisplacementProfile,
    getDisplacementSignal
  };
})();
