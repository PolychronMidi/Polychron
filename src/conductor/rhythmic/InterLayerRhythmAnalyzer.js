// src/conductor/rhythmic/InterLayerRhythmAnalyzer.js - Unified cross-layer rhythm analysis.
// Merges CrossLayerRhythmPhaseTracker + MicroTimingDriftDetector +
// PolyrhythmicAlignmentTracker + MetricDisplacementDetector.
// Provides phase relationship, timing drift, alignment flicker, and hemiola detection.
// Pure query API — no side effects.

InterLayerRhythmAnalyzer = (() => {
  const WINDOW_SECONDS = 4;
  const COINCIDENCE_THRESHOLD = 0.05; // seconds
  const ALIGNMENT_THRESHOLD = 0.08;   // seconds
  const TIGHT_THRESHOLD = 0.02;       // seconds
  const LOOSE_THRESHOLD = 0.08;       // seconds

  /**
   * Internal: Group entries by layer, sort onsets.
   * @param {number} ws - window seconds
   * @returns {{ layerOnsets: Object.<string, number[]>, layerKeys: string[] }}
   */
  function _getLayerOnsets(ws) {
    const entries = AbsoluteTimeWindow.getEntries(ws);
    /** @type {Object.<string, number[]>} */
    const layerOnsets = {};
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || typeof e.time !== 'number') continue;
      const layer = String(e.layer || 'default');
      if (!layerOnsets[layer]) layerOnsets[layer] = [];
      layerOnsets[layer].push(e.time);
    }
    const layerKeys = Object.keys(layerOnsets);
    for (let k = 0; k < layerKeys.length; k++) {
      layerOnsets[layerKeys[k]].sort((a, b) => a - b);
    }
    return { layerOnsets, layerKeys };
  }

  /**
   * Phase relationship between L1 and L2 onsets.
   * @param {number} [windowSeconds]
   * @returns {{ phase: string, coincidence: number, complementarity: number }}
   */
  function getPhaseRelationship(windowSeconds) {
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : 2;
    const l1Notes = AbsoluteTimeWindow.getNotes({ layer: 'L1', windowSeconds: ws });
    const l2Notes = AbsoluteTimeWindow.getNotes({ layer: 'L2', windowSeconds: ws });

    if (l1Notes.length < 2 || l2Notes.length < 2) {
      return { phase: 'unknown', coincidence: 0, complementarity: 0 };
    }

    let coincidentCount = 0;
    let l2Idx = 0;
    for (let i = 0; i < l1Notes.length; i++) {
      const t1 = l1Notes[i].time;
      while (l2Idx < l2Notes.length && l2Notes[l2Idx].time < t1 - COINCIDENCE_THRESHOLD) {
        l2Idx++;
      }
      if (l2Idx < l2Notes.length && m.abs(l2Notes[l2Idx].time - t1) <= COINCIDENCE_THRESHOLD) {
        coincidentCount++;
      }
    }

    const minCount = m.min(l1Notes.length, l2Notes.length);
    const coincidence = minCount > 0 ? coincidentCount / minCount : 0;
    const complementarity = clamp(1 - coincidence, 0, 1);

    let phase = 'mixed';
    if (coincidence > 0.7) phase = 'in-phase';
    else if (coincidence < 0.2) phase = 'counter-phase';
    else if (complementarity > 0.6) phase = 'complementary';

    return { phase, coincidence, complementarity };
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
   * Measure timing coherence between layers.
   * @returns {{ avgDrift: number, tightness: number, suggestion: string }}
   */
  function getDriftSignal() {
    const { layerOnsets, layerKeys } = _getLayerOnsets(WINDOW_SECONDS);

    if (layerKeys.length < 2) {
      return { avgDrift: 0, tightness: 0.5, suggestion: 'maintain' };
    }

    let totalDrift = 0;
    let pairCount = 0;

    for (let a = 0; a < layerKeys.length; a++) {
      for (let b = a + 1; b < layerKeys.length; b++) {
        const onsA = layerOnsets[layerKeys[a]];
        const onsB = layerOnsets[layerKeys[b]];
        let bIdx = 0;
        for (let i = 0; i < onsA.length; i++) {
          while (bIdx < onsB.length - 1 && m.abs(onsB[bIdx + 1] - onsA[i]) < m.abs(onsB[bIdx] - onsA[i])) {
            bIdx++;
          }
          const drift = m.abs(onsA[i] - onsB[bIdx]);
          if (drift < 0.25) {
            totalDrift += drift;
            pairCount++;
          }
        }
      }
    }

    const avgDrift = pairCount > 0 ? totalDrift / pairCount : 0;
    const tightness = clamp(1 - avgDrift / LOOSE_THRESHOLD, 0, 1);

    let suggestion = 'maintain';
    if (avgDrift < TIGHT_THRESHOLD) suggestion = 'very-tight';
    else if (avgDrift > LOOSE_THRESHOLD) suggestion = 'drifting';
    else suggestion = 'expressive';

    return { avgDrift, tightness, suggestion };
  }

  /**
   * Analyze layer alignment for convergence detection.
   * @returns {{ alignmentScore: number, convergencePoint: boolean, flickerMod: number }}
   */
  function getAlignmentSignal() {
    const { layerOnsets, layerKeys } = _getLayerOnsets(WINDOW_SECONDS);

    if (layerKeys.length < 2) {
      return { alignmentScore: 0, convergencePoint: false, flickerMod: 1 };
    }

    let alignments = 0;
    let comparisons = 0;

    for (let a = 0; a < layerKeys.length; a++) {
      for (let b = a + 1; b < layerKeys.length; b++) {
        const onsetsA = layerOnsets[layerKeys[a]];
        const onsetsB = layerOnsets[layerKeys[b]];
        let bIdx = 0;
        for (let i = 0; i < onsetsA.length; i++) {
          while (bIdx < onsetsB.length - 1 && onsetsB[bIdx + 1] <= onsetsA[i]) bIdx++;
          for (let j = m.max(0, bIdx - 1); j < m.min(onsetsB.length, bIdx + 2); j++) {
            if (m.abs(onsetsA[i] - onsetsB[j]) < ALIGNMENT_THRESHOLD) {
              alignments++;
              break;
            }
          }
          comparisons++;
        }
      }
    }

    const alignmentScore = comparisons > 0 ? alignments / comparisons : 0;
    const convergencePoint = alignmentScore > 0.6;

    let flickerMod = 1;
    if (convergencePoint) flickerMod = 1.15;
    else if (alignmentScore < 0.15) flickerMod = 0.95;

    return { alignmentScore, convergencePoint, flickerMod };
  }

  /**
   * Get flicker modifier for the flickerAmplitude chain.
   * @returns {number}
   */
  function getFlickerModifier() {
    return getAlignmentSignal().flickerMod;
  }

  /**
   * Detect metric displacement and hemiola between layers.
   * @param {number} [windowSeconds]
   * @returns {{ displacementRatio: number, hemiola: boolean, phaseOffset: number, intentional: boolean }}
   */
  function getDisplacementProfile(windowSeconds) {
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const l1Notes = AbsoluteTimeWindow.getNotes({ layer: 'L1', windowSeconds: ws });
    const l2Notes = AbsoluteTimeWindow.getNotes({ layer: 'L2', windowSeconds: ws });
    if (l1Notes.length < 4 || l2Notes.length < 4) {
      return { displacementRatio: 0, hemiola: false, phaseOffset: 0, intentional: false };
    }

    const beatDur = beatGridHelpers.getBeatDuration();

    // IOI ratios per layer
    const l1IOIs = [];
    const l2IOIs = [];
    for (let i = 1; i < l1Notes.length; i++) {
      const ioi = l1Notes[i].time - l1Notes[i - 1].time;
      if (ioi > 0) l1IOIs.push(ioi);
    }
    for (let i = 1; i < l2Notes.length; i++) {
      const ioi = l2Notes[i].time - l2Notes[i - 1].time;
      if (ioi > 0) l2IOIs.push(ioi);
    }

    if (l1IOIs.length < 2 || l2IOIs.length < 2) {
      return { displacementRatio: 0, hemiola: false, phaseOffset: 0, intentional: false };
    }

    let l1Avg = 0;
    let l2Avg = 0;
    for (let i = 0; i < l1IOIs.length; i++) l1Avg += l1IOIs[i];
    for (let i = 0; i < l2IOIs.length; i++) l2Avg += l2IOIs[i];
    l1Avg /= l1IOIs.length;
    l2Avg /= l2IOIs.length;

    const ioiRatio = l1Avg > 0 ? l2Avg / l1Avg : 1;
    const hemiola = (m.abs(ioiRatio - 1.5) < 0.15) || (m.abs(ioiRatio - 0.667) < 0.1);

    let phaseSum = 0;
    const minLen = m.min(l1Notes.length, l2Notes.length);
    for (let i = 0; i < minLen; i++) {
      const l1Phase = (l1Notes[i].time % beatDur) / beatDur;
      const l2Phase = (l2Notes[i].time % beatDur) / beatDur;
      phaseSum += m.abs(l1Phase - l2Phase);
    }
    const phaseOffset = phaseSum / minLen;
    const displacementRatio = clamp(phaseOffset, 0, 0.5);
    const intentional = displacementRatio > 0.15 && displacementRatio < 0.4;

    return { displacementRatio, hemiola, phaseOffset, intentional };
  }

  /**
   * Signal displacement status for ConductorState.
   * @returns {{ displacement: string, hemiolaActive: boolean }}
   */
  function getDisplacementSignal() {
    const profile = getDisplacementProfile();
    if (profile.hemiola) return { displacement: 'hemiola', hemiolaActive: true };
    if (profile.intentional) return { displacement: 'intentional', hemiolaActive: false };
    if (profile.displacementRatio > 0.3) return { displacement: 'accidental', hemiolaActive: false };
    return { displacement: 'aligned', hemiolaActive: false };
  }

  ConductorIntelligence.registerFlickerModifier('InterLayerRhythmAnalyzer', () => InterLayerRhythmAnalyzer.getFlickerModifier(), 0.9, 1.2);
  ConductorIntelligence.registerStateProvider('InterLayerRhythmAnalyzer', () => {
    const disp = InterLayerRhythmAnalyzer.getDisplacementSignal();
    const drift = InterLayerRhythmAnalyzer.getDriftSignal();
    const phase = InterLayerRhythmAnalyzer.getPhaseRelationship();
    const align = InterLayerRhythmAnalyzer.getAlignmentSignal();
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
