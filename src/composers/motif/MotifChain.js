// src/composers/motif/MotifChain.js - Cascading motif transformations & mutations
// Enables experimental motif feedback: transformations stack and mutate over time

MotifChain = (() => {
  let activeMotif = null;           // Current base motif
  let transforms = [];              // Array of transform specs: [{type, args}, ...]
  let chainHistory = [];            // Track applied chains for analysis

  /**
   * Set the active motif for transformation chain
   * @param {Motif} motif - Motif instance to transform
   * @throws {Error} if motif is invalid
   */
  function setActive(motif) {
    if (!motif || typeof motif.transpose !== 'function') {
      throw new Error('MotifChain.setActive: motif must be a Motif instance with transform methods');
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
      throw new Error(`MotifChain.addTransform: unknown transform type "${type}". Valid: ${validTypes.join(', ')}`);
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
      throw new Error('MotifChain.apply: no active motif set');
    }

    let result = activeMotif;
    const appliedTransforms = [];

    for (const { type, args } of transforms) {
      try {
        if (typeof result[type] !== 'function') {
          throw new Error(`MotifChain.apply: motif has no method "${type}"`);
        }
        result = result[type](...args);
        appliedTransforms.push({ type, args });
      } catch (e) {
        throw new Error(`MotifChain.apply: transform "${type}" failed: ${e && e.message ? e.message : e}`);
      }
    }

    // Record to history
    chainHistory.push({
      baseMotif: activeMotif,
      transforms: appliedTransforms,
      resultLength: result.sequence ? result.sequence.length : 0,
    });

    // Emit event for feedback loops
    if (typeof EventBus !== 'undefined') {
      try {
        EventBus.emit('motif-chain-applied', {
          transformCount: appliedTransforms.length,
          resultNoteCount: result.sequence ? result.sequence.length : 0
        });
      } catch (e) {
        // Don't fail the chain if event emission fails, but do throw for visibility
        throw new Error(`MotifChain.apply: EventBus emit failed: ${e && e.message ? e.message : e}`);
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
      throw new Error('MotifChain.applyToNotes: transformed motif missing applyToNotes method');
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
      throw new Error('MotifChain.mutate: no active motif to mutate');
    }

    const {
      transposeRange = [-7, 7],
      allowInvert = true,
      allowReverse = true,
      allowAugment = true,
      augmentRange = [1.5, 3]
    } = options;

    // Pick random mutation type
    const mutations = [];
    mutations.push(() => addTransform('transpose', ri(...transposeRange)));
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
