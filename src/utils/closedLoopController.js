// closedLoopController.js - Reusable factory for closed-loop feedback controllers.
// Extracts the common observe - deviation - correction cycle found in coherenceMonitor,
// entropyRegulator, pipelineCouplingManager, regimeReactiveDamping, and adaptiveTrustScores.
// Each controller auto-registers with feedbackRegistry and provides EMA smoothing,
// clamp boundaries, and resonance dampening. New feedback loops become 5-line declarations.

closedLoopController = (() => {
  const V = validator.create('closedLoopController');

  /**
   * @typedef {{
   *   name: string,
   *   observe: () => number,
   *   target: () => number,
   *   gain?: number | (() => number),
   *   smoothing?: number,
   *   clampRange?: [number, number],
   *   sourceDomain: string,
   *   targetDomain: string,
   *   invert?: boolean,
   *   deadband?: number
   * }} ClosedLoopControllerConfig
   */

  /**
   * @typedef {{
   *   getBias: () => number,
   *   getError: () => number,
   *   getAmplitude: () => number,
   *   getPhase: () => number,
   *   getMetrics: () => { bias: number, error: number, observed: number, target: number, amplitude: number, phase: number },
   *   reset: () => void,
   *   refresh: () => void,
   *   name: string
   * }} ClosedLoopControllerInstance
   */

  /** @type {ClosedLoopControllerInstance[]} */
  const instances = [];

  /**
   * Create a new closed-loop feedback controller.
   *
   * @param {ClosedLoopControllerConfig} config
   * @returns {ClosedLoopControllerInstance}
   *
   * @example
   * closedLoopController.create({
   *   name: 'myDensityCorrector',
   *   observe: () => signalReader.density(),
   *   target: () => 1.0,
   *   gain: 0.5,
   *   smoothing: 0.3,
   *   clampRange: [0.8, 1.2],
   *   sourceDomain: 'density_product',
   *   targetDomain: 'density'
   * });
   */
  function create(config) {
    V.assertPlainObject(config, 'config');
    V.assertNonEmptyString(config.name, 'config.name');
    V.requireType(config.observe, 'function', 'config.observe');
    V.requireType(config.target, 'function', 'config.target');
    V.assertNonEmptyString(config.sourceDomain, 'config.sourceDomain');
    V.assertNonEmptyString(config.targetDomain, 'config.targetDomain');

    // Check for duplicate names
    if (instances.some(i => i.name === config.name)) {
      throw new Error(`closedLoopController.create: duplicate name "${config.name}"`);
    }

    const name = config.name;
    const observe = config.observe;
    const target = config.target;
    const gainCfg = config.gain;
    const gainFn = /** @type {(()=>number)|null} */ (typeof gainCfg === 'function' ? gainCfg : null);
    const gainVal = gainFn ? 0 : V.optionalFinite(/** @type {number|undefined} */ (gainCfg), 0.5);
    const smoothing = clamp(V.optionalFinite(config.smoothing, 0.3), 0, 0.99);
    const lo = Array.isArray(config.clampRange) ? V.requireFinite(config.clampRange[0], 'clampRange[0]') : 0.7;
    const hi = Array.isArray(config.clampRange) ? V.requireFinite(config.clampRange[1], 'clampRange[1]') : 1.3;
    const invert = Boolean(config.invert);
    const deadband = V.optionalFinite(config.deadband, 0);

    // Internal state
    let bias = 1.0;
    let lastError = 0;
    let lastObserved = 0;
    let lastTarget = 0;

    /** Recompute bias from current observation and target. */
    function refresh() {
      const observed = V.requireFinite(observe(), name + '.observe()');
      const tgt = V.requireFinite(target(), name + '.target()');
      lastObserved = observed;
      lastTarget = tgt;

      // Error: positive when observed < target (need boost), negative when observed > target
      const rawError = tgt - observed;

      // Apply deadband: errors within the band are treated as zero
      const abErr = m.abs(rawError);
      const adjError = abErr <= deadband ? 0 : m.sign(rawError) * (abErr - deadband);
      lastError = adjError;

      // Resolve gain (may be dynamic)
      const g = gainFn ? V.requireFinite(gainFn(), name + '.gain()') : gainVal;

      // Correction: bias > 1 to boost, < 1 to suppress
      const direction = invert ? -1 : 1;
      const correction = 1.0 + adjError * g * direction;

      // EMA smoothing
      const smoothed = bias * smoothing + correction * (1 - smoothing);

      // Resonance dampening from feedbackRegistry
      const dampening = feedbackRegistry.getResonanceDampening(name);
      const dampened = dampening < 1.0
        ? 1.0 + (smoothed - 1.0) * dampening
        : smoothed;

      bias = clamp(dampened, lo, hi);
    }

    /** @returns {number} Current bias multiplier. */
    function getBias() { return bias; }

    /** @returns {number} Last computed error (target - observed). */
    function getError() { return lastError; }

    /** @returns {number} Correction amplitude (0-1 scale for feedbackRegistry). */
    function getAmplitude() {
      return clamp(m.abs(bias - 1.0) / m.max(m.abs(hi - 1.0), m.abs(1.0 - lo), 0.01), 0, 1);
    }

    /** @returns {number} Correction direction (-1 to 1 for feedbackRegistry). */
    function getPhase() {
      return m.sign(bias - 1.0);
    }

    /** @returns {{ bias: number, error: number, observed: number, target: number, amplitude: number, phase: number }} */
    function getMetrics() {
      return {
        bias,
        error: lastError,
        observed: lastObserved,
        target: lastTarget,
        amplitude: getAmplitude(),
        phase: getPhase()
      };
    }

    /** Reset to neutral. */
    function reset() {
      bias = 1.0;
      lastError = 0;
      lastObserved = 0;
      lastTarget = 0;
    }

    // Register with feedbackRegistry for resonance coordination
    feedbackRegistry.registerLoop(
      name,
      config.sourceDomain,
      config.targetDomain,
      getAmplitude,
      getPhase
    );

    const instance = { getBias, getError, getAmplitude, getPhase, getMetrics, reset, refresh, name };
    instances.push(instance);
    return instance;
  }

  /** @returns {string[]} Names of all created controllers. */
  function getNames() {
    return instances.map(i => i.name);
  }

  /** @returns {number} Count of created controllers. */
  function getCount() {
    return instances.length;
  }

  /**
   * Get a snapshot of all controllers for diagnostic output.
   * @returns {Record<string, { bias: number, error: number, amplitude: number, phase: number }>}
   */
  function getSnapshot() {
    /** @type {Record<string, { bias: number; error: number; amplitude: number; phase: number }>} */
    const snap = {};
    for (let i = 0; i < instances.length; i++) {
      snap[instances[i].name] = instances[i].getMetrics();
    }
    return snap;
  }

  return { create, getNames, getCount, getSnapshot };
})();
