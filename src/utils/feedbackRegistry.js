// src/utils/feedbackRegistry.js - Formal registry for closed-loop feedback controllers.
// Prevents catastrophic resonance by tracking phase, amplitude, and target domains
// of all active feedback loops.

feedbackRegistry = (() => {
  const V = validator.create('feedbackRegistry');

  /**
   * @typedef {{
   *   name: string,
   *   sourceDomain: string,
   *   targetDomain: string,
   *   getAmplitude: function(): number,
   *   getPhase: function(): number
   * }} FeedbackLoop
   */

  /** @type {Map<string, FeedbackLoop>} */
  const loops = new Map();

  /**
   * Register a closed-loop feedback controller.
   * @param {string} name - unique name of the loop
   * @param {string} sourceDomain - what it listens to (e.g., 'notes_emitted', 'entropy')
   * @param {string} targetDomain - what it regulates (e.g., 'density', 'cross_layer_prob')
   * @param {function(): number} getAmplitude - returns current correction strength (0-1)
   * @param {function(): number} getPhase - returns current direction (-1 to 1)
   */
  function registerLoop(name, sourceDomain, targetDomain, getAmplitude, getPhase) {
    V.assertNonEmptyString(name, 'name');
    V.assertNonEmptyString(sourceDomain, 'sourceDomain');
    V.assertNonEmptyString(targetDomain, 'targetDomain');
    V.requireType(getAmplitude, 'function', 'getAmplitude');
    V.requireType(getPhase, 'function', 'getPhase');

    loops.set(name, { name, sourceDomain, targetDomain, getAmplitude, getPhase });
  }

  /**
   * Detect destructive interference or runaway positive feedback.
   * Returns a dampening factor (0-1) for a specific loop to prevent resonance.
   * @param {string} name
   * @returns {number} 1.0 = no dampening, < 1.0 = dampen
   */
  function getResonanceDampening(name) {
    const loop = loops.get(name);
    if (!loop) return 1.0;

    let dampening = 1.0;
    const myPhase = loop.getPhase();
    const myAmp = loop.getAmplitude();

    if (myAmp < 0.1) return 1.0;

    for (const other of loops.values()) {
      if (other.name === name) continue;

      // If two loops target the same domain and are pushing hard in the same direction,
      // they might cause runaway positive feedback. Dampen them.
      if (other.targetDomain === loop.targetDomain) {
        const otherPhase = other.getPhase();
        const otherAmp = other.getAmplitude();

        if (otherAmp > 0.5 && m.sign(myPhase) === m.sign(otherPhase)) {
          dampening *= 0.7; // Apply 30% dampening
        }
      }
    }

    // Apply correlation shuffler perturbation if active
    const shuffleScale = correlationShuffler.getShuffleScale(name);
    dampening *= /** @type {number} */ (shuffleScale);

    return clamp(dampening, 0.1, 1.5);
  }

  function getSnapshot() {
    /** @type {{ [name: string]: { source: string, target: string, amplitude: number, phase: number, dampening: number } }} */
    const snap = {};
    for (const [name, loop] of loops.entries()) {
      snap[name] = {
        source: loop.sourceDomain,
        target: loop.targetDomain,
        amplitude: loop.getAmplitude(),
        phase: loop.getPhase(),
        dampening: getResonanceDampening(name)
      };
    }
    return snap;
  }

  return {
    registerLoop,
    getResonanceDampening,
    getSnapshot
  };
})();
