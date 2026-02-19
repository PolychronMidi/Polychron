// src/conductor/MetricDisplacementDetector.js - Hemiola and metric modulation detection.
// Compares onset patterns across layers to detect beat-displacement patterns.
// Pure query API — signals when displacement is intentional vs accidental.

MetricDisplacementDetector = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Detect metric displacement between layers.
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

    // Beat duration in seconds
    const beatDur = (typeof tpSec !== 'undefined' && typeof tpBeat !== 'undefined'
      && Number.isFinite(tpSec) && Number.isFinite(tpBeat) && tpSec > 0)
      ? tpBeat / tpSec
      : 0.5;

    // Compute IOI ratios for each layer
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

    // Average IOI per layer
    let l1Avg = 0;
    let l2Avg = 0;
    for (let i = 0; i < l1IOIs.length; i++) l1Avg += l1IOIs[i];
    for (let i = 0; i < l2IOIs.length; i++) l2Avg += l2IOIs[i];
    l1Avg /= l1IOIs.length;
    l2Avg /= l2IOIs.length;

    // IOI ratio — hemiola if close to 3:2 or 2:3
    const ioiRatio = l1Avg > 0 ? l2Avg / l1Avg : 1;
    const hemiola = (m.abs(ioiRatio - 1.5) < 0.15) || (m.abs(ioiRatio - 0.667) < 0.1);

    // Phase offset: average difference of onset positions within the beat grid
    let phaseSum = 0;
    const minLen = m.min(l1Notes.length, l2Notes.length);
    for (let i = 0; i < minLen; i++) {
      const l1Phase = (l1Notes[i].time % beatDur) / beatDur;
      const l2Phase = (l2Notes[i].time % beatDur) / beatDur;
      phaseSum += m.abs(l1Phase - l2Phase);
    }
    const phaseOffset = phaseSum / minLen;

    // Displacement ratio: how much layers are offset (0 = aligned, 0.5 = max)
    const displacementRatio = clamp(phaseOffset, 0, 0.5);

    // Intentional: consistent displacement suggests deliberate pattern
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

  return {
    getDisplacementProfile,
    getDisplacementSignal
  };
})();
