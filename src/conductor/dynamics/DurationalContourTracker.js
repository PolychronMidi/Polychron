// src/conductor/DurationalContourTracker.js - Tracks note-duration trajectory over time.
// Detects acceleration (durations getting shorter) or deceleration (durations getting longer).
// Pure query API — biases duration envelope for intentional temporal shaping.

DurationalContourTracker = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Analyze duration contour in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, trend: string, avgDuration: number, accelerating: boolean, decelerating: boolean }}
   */
  function getDurationContour(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { slope: 0, trend: 'insufficient', avgDuration: 0, accelerating: false, decelerating: false };
    }

    // Beat duration for normalization
    const beatDur = (typeof tpSec !== 'undefined' && typeof tpBeat !== 'undefined'
      && Number.isFinite(tpSec) && Number.isFinite(tpBeat) && tpSec > 0)
      ? tpBeat / tpSec
      : 0.5;

    const half = m.ceil(notes.length / 2);
    let sumFirst = 0;
    let sumSecond = 0;
    let countFirst = 0;
    let countSecond = 0;

    for (let i = 0; i < half; i++) {
      const dur = (typeof notes[i].duration === 'number' && Number.isFinite(notes[i].duration))
        ? notes[i].duration : beatDur * 0.5;
      sumFirst += dur;
      countFirst++;
    }
    for (let i = half; i < notes.length; i++) {
      const dur = (typeof notes[i].duration === 'number' && Number.isFinite(notes[i].duration))
        ? notes[i].duration : beatDur * 0.5;
      sumSecond += dur;
      countSecond++;
    }

    const avgFirst = countFirst > 0 ? sumFirst / countFirst : 0;
    const avgSecond = countSecond > 0 ? sumSecond / countSecond : 0;
    const avgDuration = (avgFirst + avgSecond) / 2;
    const slope = avgSecond - avgFirst;

    // Normalize slope relative to beat duration for threshold comparison
    const normalizedSlope = beatDur > 0 ? slope / beatDur : 0;

    let trend = 'stable';
    if (normalizedSlope < -0.1) trend = 'accelerating';
    else if (normalizedSlope > 0.1) trend = 'decelerating';

    return {
      slope,
      trend,
      avgDuration,
      accelerating: normalizedSlope < -0.1,
      decelerating: normalizedSlope > 0.1
    };
  }

  /**
   * Get duration envelope bias for temporal shaping.
   * Accelerating → gently resist (boost longer durations); decelerating → gently resist (boost shorter).
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ durationBias: number, flickerMod: number }}
   */
  function getDurationBias(opts) {
    const contour = getDurationContour(opts);
    if (contour.accelerating) {
      return { durationBias: 1.15, flickerMod: 1.1 };
    }
    if (contour.decelerating) {
      return { durationBias: 0.85, flickerMod: 1.05 };
    }
    return { durationBias: 1.0, flickerMod: 1.0 };
  }

  return {
    getDurationContour,
    getDurationBias
  };
})();
