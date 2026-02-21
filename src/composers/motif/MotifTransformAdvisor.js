// src/composers/motif/MotifTransformAdvisor.js - Advises MotifChain.mutate() on transforms.
// Uses contour, coherence, section phase, and excursion to select contextually
// appropriate motif transformations. Pure query API.

MotifTransformAdvisor = (() => {
  /**
   * Advise which motif transform parameters to use for the current musical context.
   * Returns mutation options compatible with MotifChain.mutate().
   * @returns {{ transposeRange: [number, number], rotateRange: [number, number], allowInvert: boolean, allowReverse: boolean, allowAugment: boolean, augmentRange: [number, number] }}
   */
  function adviseTransform() {
    // Gather context from available sources
    const contour = MelodicContourTracker.getContour();

    const coherence = LayerCoherenceScorer.getCoherence();

    const phase = HarmonicContext.getField('sectionPhase');

    const excursion = HarmonicContext.getField('excursion');

    // Base defaults
    /** @type {[number, number]} */
    let transposeRange = [-5, 5];
    /** @type {[number, number]} */
    let rotateRange = [-2, 2];
    let allowInvert = true;
    let allowReverse = true;
    let allowAugment = true;
    /** @type {[number, number]} */
    let augmentRange = [1.5, 3];

    // Phase-driven adjustments
    switch (phase) {
      case 'exposition':
        // Conservative transforms early in the section
        transposeRange = [-3, 3];
        rotateRange = [-1, 1];
        allowInvert = false;
        allowAugment = false;
        break;
      case 'development':
        // Wider exploration
        transposeRange = [-7, 7];
        rotateRange = [-3, 3];
        allowAugment = true;
        break;
      case 'climax':
        // Bold transforms at peak intensity
        transposeRange = [-5, 5];
        rotateRange = [-2, 2];
        allowInvert = true;
        allowAugment = true;
        augmentRange = [2, 4];
        break;
      case 'resolution':
      case 'conclusion':
        // Gentle, stabilizing transforms
        transposeRange = [-2, 2];
        rotateRange = [-1, 1];
        allowInvert = false;
        allowReverse = false;
        allowAugment = false;
        break;
      // no default — base values already set
    }

    // Contour-driven adjustments: favor contrary motion
    if (contour.shape === 'rising' && contour.direction > 0.3) {
      // Bias downward transposition
      transposeRange = [m.min(transposeRange[0], -5), m.min(transposeRange[1], 2)];
    } else if (contour.shape === 'falling' && contour.direction < -0.3) {
      // Bias upward transposition
      transposeRange = [m.max(transposeRange[0], -2), m.max(transposeRange[1], 5)];
    }

    // Coherence-driven adjustments: low coherence → simpler transforms
    if (coherence < 0.3) {
      transposeRange = [m.max(transposeRange[0], -2), m.min(transposeRange[1], 2)];
      rotateRange = [-1, 1];
      allowInvert = false;
      allowReverse = false;
    }

    // High excursion (far from home key) → more conservative
    if (excursion > 3) {
      transposeRange = [m.max(transposeRange[0], -3), m.min(transposeRange[1], 3)];
      allowAugment = false;
    }

    return {
      transposeRange,
      rotateRange,
      allowInvert,
      allowReverse,
      allowAugment,
      augmentRange
    };
  }

  /**
   * Get a transform complexity score (0-1) for the current context.
   * Useful for deciding whether to mutate at all.
   * @returns {number}
   */
  function getTransformComplexity() {
    const phase = HarmonicContext.getField('sectionPhase');

    const coherence = LayerCoherenceScorer.getCoherence();

    const baseComplexity = {
      exposition: 0.2,
      development: 0.6,
      climax: 0.8,
      resolution: 0.3,
      conclusion: 0.15
    }[phase] || 0.4;

    // Low coherence reduces complexity to avoid making things worse
    const coherenceFactor = clamp(coherence, 0.3, 1);
    return clamp(baseComplexity * coherenceFactor, 0, 1);
  }

  return {
    adviseTransform,
    getTransformComplexity
  };
})();
