// src/composers/motif/motifChain.js - Cascading motif transformations & mutations
// Enables experimental motif feedback: transformations stack and mutate over time

motifChain = (() => {
  const V = validator.create('motifChain');

  let activeMotif = null;           // Current base motif
  let transforms = [];              // Array of transform specs: [{type, args}, ...]
  let chainHistory = [];            // Track applied chains for analysis

  /**
   * Set the active motif for transformation chain
   * @param {Motif} motif - Motif instance to transform
   * @throws {Error} if motif is invalid
   */
  function setActive(motif) {
    if (!motif || typeof motif.rotate !== 'function') {
      throw new Error('motifChain.setActive: motif must be a Motif instance with transform methods');
    }
    activeMotif = motif;
    transforms = []; // Reset transforms when setting new motif
  }

  /**
   * Get current active motif (untransformed)
   * @returns {Motif|null}
   */
  function getActive() {
    return activeMotif;
  }

  /**
   * Add a transformation to the chain
  * @param {string} type - Transform type: 'transpose', 'rotate', 'invert', 'augment', 'diminish', 'reverse', 'develop'
   * @param {Array} args - Arguments for the transform method
   * @throws {Error} if type is invalid
   */
  function addTransform(type, ...args) {
    const validTypes = ['transpose', 'rotate', 'invert', 'augment', 'diminish', 'reverse', 'develop'];
    if (!validTypes.includes(type)) {
      throw new Error(`motifChain.addTransform: unknown transform type "${type}". Valid: ${validTypes.join(', ')}`);
    }
    transforms.push({ type, args });
  }

  /**
   * Apply all transforms in sequence to active motif
   * @returns {Motif} transformed motif
   * @throws {Error} if no active motif or transform fails
   */
  function apply() {
    if (!activeMotif) {
      throw new Error('motifChain.apply: no active motif set');
    }

    let result = activeMotif;
    const appliedTransforms = [];

    for (const { type, args } of transforms) {
      try {
        if (typeof result[type] !== 'function') {
          throw new Error(`motifChain.apply: motif has no method "${type}"`);
        }
        result = result[type](...args);
        appliedTransforms.push({ type, args });
      } catch (e) {
        throw new Error(`motifChain.apply: transform "${type}" failed: ${e && e.message ? e.message : e}`);
      }
    }

    // Record to history
    chainHistory.push({
      baseMotif: activeMotif,
      transforms: appliedTransforms,
      resultLength: result.sequence ? result.sequence.length : 0,
    });

    // Emit event for feedback loops
    if (eventBus) {
      try {
        const EVENTS = V.getEventsOrThrow();
        eventBus.emit(EVENTS.MOTIF_CHAIN_APPLIED, {
          transformCount: appliedTransforms.length,
          resultNoteCount: result.sequence ? result.sequence.length : 0
        });
      } catch (e) {
        // Don't fail the chain if event emission fails, but do throw for visibility
        throw new Error(`motifChain.apply: eventBus emit failed: ${e && e.message ? e.message : e}`);
      }
    }

    return result;
  }

  /**
   * Apply chain and return transformed notes directly
   * @param {{note:number}[]} notes - Notes to apply transformed motif to
   * @param {Object} options - Options for applyToNotes
   * @returns {{note:number}[]}
   */
  function applyToNotes(notes, options = {}) {
    const transformed = apply();
    if (typeof transformed.applyToNotes !== 'function') {
      throw new Error('motifChain.applyToNotes: transformed motif missing applyToNotes method');
    }
    return transformed.applyToNotes(notes, options);
  }

  /**
   * Mutate the chain by adding a random transformation
   * Useful for experimental complexity and emergent development
   * @param {Object} options - Mutation options
   * @throws {Error} if no active motif
   */
  function mutate(options = {}) {
    if (!activeMotif) {
      throw new Error('motifChain.mutate: no active motif to mutate');
    }

    const mutationProfile = conductorConfig.getMotifMutationParams();
    const defaultTransposeRange = (Array.isArray(mutationProfile.transposeRange) && mutationProfile.transposeRange.length === 2)
      ? mutationProfile.transposeRange
      : [-7, 7];

    // Overlay context-aware transform advice from motifTransformAdvisor
    const advisorOpts = motifTransformAdvisor.adviseTransform();

    const {
      transposeRange = advisorOpts.transposeRange || defaultTransposeRange,
      rotateRange = advisorOpts.rotateRange || null,
      allowInvert = advisorOpts.allowInvert !== undefined ? advisorOpts.allowInvert : true,
      allowReverse = advisorOpts.allowReverse !== undefined ? advisorOpts.allowReverse : true,
      allowAugment = advisorOpts.allowAugment !== undefined ? advisorOpts.allowAugment : true,
      augmentRange = advisorOpts.augmentRange || [1.5, 3]
    } = options;
    // rotateRange uses transposeRange as fallback for backward compat,
    // but callers can now separate pitch vs sequence ranges.
    const effectiveRotateRange = rotateRange || transposeRange;

    // Pick random mutation type
    const mutations = [];
    mutations.push(() => addTransform('transpose', ri(...transposeRange)));
    mutations.push(() => addTransform('rotate', ri(...effectiveRotateRange)));
    if (allowInvert) mutations.push(() => addTransform('invert'));
    if (allowReverse) mutations.push(() => addTransform('reverse'));
    if (allowAugment) mutations.push(() => addTransform('augment', rf(...augmentRange)));

    const mutation = mutations[ri(mutations.length - 1)];
    mutation();
  }

  /**
   * Clear all transforms (keep active motif)
   */
  function clearTransforms() {
    transforms = [];
  }

  /**
   * Reset entire chain (clear motif and transforms)
   */
  function reset() {
    activeMotif = null;
    transforms = [];
    chainHistory = [];
  }

  /**
   * Get current transform stack
   * @returns {Array<{type:string, args:Array}>}
   */
  function getTransforms() {
    return [...transforms];
  }

  /**
   * Get chain history (for analysis/debugging)
   * @param {number} limit - Max records to return
   * @returns {Array}
   */
  function getHistory(limit = 50) {
    return chainHistory.slice(-limit);
  }

  return {
    setActive,
    getActive,
    addTransform,
    apply,
    applyToNotes,
    mutate,
    clearTransforms,
    reset,
    getTransforms,
    getHistory
  };
})();
