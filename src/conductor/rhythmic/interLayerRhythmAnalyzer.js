// src/conductor/rhythmic/interLayerRhythmAnalyzer.js - Unified cross-layer rhythm analysis.
// Merges CrossLayerRhythmPhaseTracker + MicroTimingDriftDetector +
// PolyrhythmicAlignmentTracker + MetricDisplacementDetector.
// Provides phase relationship, timing drift, alignment flicker, and hemiola detection.
// Pure query API - no side effects.

moduleLifecycle.declare({
  name: 'interLayerRhythmAnalyzer',
  subsystem: 'conductor',
  deps: [],
  provides: ['interLayerRhythmAnalyzer'],
  init: (deps) => {
  // Beat-level caches - each analysis function is called 2+ times per beat
  // (once from flicker/bias registration, once from stateProvider).
  const interLayerRhythmAnalyzerPhaseCache = beatCache.create(() => interLayerRhythmHelpers.computePhaseRelationship());
  const interLayerRhythmAnalyzerDriftCache = beatCache.create(() => interLayerRhythmHelpers.computeDriftSignal());
  const interLayerRhythmAnalyzerAlignCache = beatCache.create(() => interLayerRhythmHelpers.computeAlignmentSignal());
  const interLayerRhythmAnalyzerDispCache  = beatCache.create(() => interLayerRhythmHelpers.computeDisplacementProfile());

  /**
   * Phase relationship between L1 and L2 onsets (cached per beat for default window).
   * @param {number} [windowSeconds]
   * @returns {{ phase: string, coincidence: number, complementarity: number }}
   */
  function getPhaseRelationship(windowSeconds) {
    if (windowSeconds === undefined) return interLayerRhythmAnalyzerPhaseCache.get();
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
  function getDriftSignal() { return interLayerRhythmAnalyzerDriftCache.get(); }

  /**
   * Analyze layer alignment for convergence detection (cached per beat).
   * @returns {{ alignmentScore: number, convergencePoint: boolean, flickerMod: number }}
   */
  function getAlignmentSignal() { return interLayerRhythmAnalyzerAlignCache.get(); }

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
    if (windowSeconds === undefined) return interLayerRhythmAnalyzerDispCache.get();
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

  /**
   * R30 E4: Density bias from rhythmic complementarity -- new rhythmic-to-density pathway.
   * Complementary layers (independent, interlocking) support richer texture;
   * in-phase layers (redundant) need less density.
   * Continuous ramp on complementarity: 0->0.96, 0.5->1.0, 1->1.04.
   * @returns {number}
   */
  function getDensityBias() {
    const rel = getPhaseRelationship();
    return 0.96 + clamp(rel.complementarity, 0, 1) * 0.08;
  }

  conductorIntelligence.registerDensityBias('interLayerRhythmAnalyzer', () => interLayerRhythmAnalyzer.getDensityBias(), 0.96, 1.04);

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

  function reset() {}
  conductorIntelligence.registerModule('interLayerRhythmAnalyzer', { reset }, ['section']);

  return {
    getPhaseRelationship,
    suggestPhaseStrategy,
    getDriftSignal,
    getAlignmentSignal,
    getFlickerModifier,
    getDensityBias,
    getDisplacementProfile,
    getDisplacementSignal
  };
  },
});
