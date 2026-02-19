// src/conductor/VelocityContourTracker.js - Velocity trajectory shape analysis.
// Detects crescendo, decrescendo, terraced, or flat dynamics in the ATW window.
// Pure query API — shapes flickerAmplitude and dynamics envelope.

VelocityContourTracker = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Analyze velocity trajectory in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ slope: number, shape: string, avgVelocity: number, flat: boolean }}
   */
  function getVelocityContour(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { slope: 0, shape: 'insufficient', avgVelocity: 64, flat: true };
    }

    const half = m.ceil(notes.length / 2);
    let sumFirst = 0;
    let sumSecond = 0;

    for (let i = 0; i < half; i++) {
      sumFirst += (typeof notes[i].velocity === 'number' ? notes[i].velocity : 64);
    }
    for (let i = half; i < notes.length; i++) {
      sumSecond += (typeof notes[i].velocity === 'number' ? notes[i].velocity : 64);
    }

    const avgFirst = sumFirst / half;
    const avgSecond = sumSecond / (notes.length - half);
    const avgVelocity = (avgFirst + avgSecond) / 2;
    const slope = avgSecond - avgFirst;

    // Detect terraced dynamics: large jumps between groups
    let jumpCount = 0;
    const groupSize = m.max(2, m.floor(notes.length / 4));
    for (let g = 0; g < notes.length - groupSize; g += groupSize) {
      let gAvg1 = 0;
      let gAvg2 = 0;
      for (let j = 0; j < groupSize; j++) {
        gAvg1 += (typeof notes[g + j].velocity === 'number' ? notes[g + j].velocity : 64);
        if (g + groupSize + j < notes.length) {
          gAvg2 += (typeof notes[g + groupSize + j].velocity === 'number' ? notes[g + groupSize + j].velocity : 64);
        }
      }
      gAvg1 /= groupSize;
      gAvg2 /= groupSize;
      if (m.abs(gAvg2 - gAvg1) > 15) jumpCount++;
    }

    let shape = 'stable';
    if (jumpCount > 1) shape = 'terraced';
    else if (slope > 8) shape = 'crescendo';
    else if (slope < -8) shape = 'decrescendo';
    else if (m.abs(slope) < 3) shape = 'flat';

    return {
      slope,
      shape,
      avgVelocity,
      flat: shape === 'flat'
    };
  }

  /**
   * Get a flicker modifier based on velocity contour.
   * Flat dynamics → widen flicker for variety; terraced → reduce to let jumps speak.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.85 to 1.2
   */
  function getFlickerModifier(opts) {
    const contour = getVelocityContour(opts);
    if (contour.flat) return 1.15;
    if (contour.shape === 'terraced') return 0.9;
    return 1.0;
  }

  return {
    getVelocityContour,
    getFlickerModifier
  };
})();
