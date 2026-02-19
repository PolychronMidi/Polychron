// src/conductor/RestDensityTracker.js - Tracks rest-to-onset ratio across layers.
// Flags over-saturation (wall of sound) or sparse deserts.
// Pure query API — biases rhythm onset probability.

RestDensityTracker = (() => {
  const WINDOW_SECONDS = 4;

  /**
   * Get onset density: notes per second in the recent window.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ notesPerSecond: number, saturated: boolean, sparse: boolean }}
   */
  function getOnsetDensity(opts) {
    const { layer, windowSeconds } = opts || {};
    const ws = (typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)) ? windowSeconds : WINDOW_SECONDS;
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 2) {
      return { notesPerSecond: 0, saturated: false, sparse: true };
    }

    const first = notes[0];
    const last = notes[notes.length - 1];
    if (!first || !last) return { notesPerSecond: 0, saturated: false, sparse: true };

    const span = last.time - first.time;
    if (span <= 0) return { notesPerSecond: 0, saturated: false, sparse: true };

    const nps = notes.length / span;
    return {
      notesPerSecond: nps,
      saturated: nps > 12,
      sparse: nps < 1.5
    };
  }

  /**
   * Bias factor for rhythm onset probability.
   * Saturated → reduce onsets; sparse → boost onsets.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 0.7 to 1.3
   */
  function getOnsetBias(opts) {
    const density = getOnsetDensity(opts);
    if (density.saturated) return 0.75;
    if (density.sparse) return 1.25;
    return 1.0;
  }

  /**
   * Compare density across layers. Returns which layer is denser.
   * @returns {{ denser: string, ratio: number }}
   */
  function getCrossLayerBalance() {
    const l1 = getOnsetDensity({ layer: 'L1' });
    const l2 = getOnsetDensity({ layer: 'L2' });
    const l1nps = l1.notesPerSecond;
    const l2nps = l2.notesPerSecond;
    if (l1nps === 0 && l2nps === 0) return { denser: 'equal', ratio: 1 };
    if (l2nps === 0) return { denser: 'L1', ratio: 2 };
    if (l1nps === 0) return { denser: 'L2', ratio: 2 };
    const ratio = l1nps / l2nps;
    if (ratio > 1.5) return { denser: 'L1', ratio };
    if (ratio < 0.67) return { denser: 'L2', ratio: 1 / ratio };
    return { denser: 'equal', ratio };
  }

  return {
    getOnsetDensity,
    getOnsetBias,
    getCrossLayerBalance
  };
})();
