// src/conductor/rhythmic/interLayerRhythmHelpers.js
// Pure computation helpers extracted from interLayerRhythmAnalyzer.
// Five analysis functions operating on absoluteTimeWindow data.

interLayerRhythmHelpers = (() => {
  const V = validator.create('interLayerRhythmHelpers');
  const WINDOW_SECONDS        = 4;
  const COINCIDENCE_THRESHOLD = 0.05; // seconds
  const ALIGNMENT_THRESHOLD   = 0.08; // seconds
  const TIGHT_THRESHOLD       = 0.02; // seconds
  const LOOSE_THRESHOLD       = 0.08; // seconds

  /**
   * Group absoluteTimeWindow entries by layer, sort onsets.
   * @param {number} ws
   * @returns {{ layerOnsets: Object.<string, number[]>, layerKeys: string[] }}
   */
  function getLayerOnsets(ws) {
    const entries = L0.query('note', { windowSeconds: ws });
    /** @type {Object.<string, number[]>} */
    const layerOnsets = {};
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || !Number.isFinite(e.time)) continue;
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
  function computePhaseRelationship(windowSeconds) {
    const { l1Notes, l2Notes } = analysisHelpers.getWindowLayerPairNotes(V, windowSeconds, 2);

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
   * Timing coherence between layers.
   * @returns {{ avgDrift: number, tightness: number, suggestion: string }}
   */
  function computeDriftSignal() {
    const { layerOnsets, layerKeys } = getLayerOnsets(WINDOW_SECONDS);

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
   * Layer alignment for convergence detection.
   * @returns {{ alignmentScore: number, convergencePoint: boolean, flickerMod: number }}
   */
  function computeAlignmentSignal() {
    const { layerOnsets, layerKeys } = getLayerOnsets(WINDOW_SECONDS);

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

    // Continuous ramp: alignmentScore 0-0.15 - flickerMod 0.95-1.0,
    //                    alignmentScore 0.6-1.0 - flickerMod 1.0-1.15
    let flickerMod = 1;
    if (convergencePoint) {
      flickerMod = 1.0 + clamp((alignmentScore - 0.6) / 0.4, 0, 1) * 0.15;
    } else if (alignmentScore < 0.15) {
      flickerMod = 0.95 + (alignmentScore / 0.15) * 0.05;
    }

    return { alignmentScore, convergencePoint, flickerMod };
  }

  /**
   * Metric displacement and hemiola between layers.
   * @param {number} [windowSeconds]
   * @returns {{ displacementRatio: number, hemiola: boolean, phaseOffset: number, intentional: boolean }}
   */
  function computeDisplacementProfile(windowSeconds) {
    const { l1Notes, l2Notes } = analysisHelpers.getWindowLayerPairNotes(V, windowSeconds, WINDOW_SECONDS);

    if (l1Notes.length < 4 || l2Notes.length < 4) {
      return { displacementRatio: 0, hemiola: false, phaseOffset: 0, intentional: false };
    }

    const beatDur = beatGridHelpers.getBeatDuration();

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

  return { getLayerOnsets, computePhaseRelationship, computeDriftSignal, computeAlignmentSignal, computeDisplacementProfile };
})();
