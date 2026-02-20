// src/conductor/ConductorIntelligence.js — Registry for conductor intelligence modules.
// Each intelligence module self-registers its contributions (density biases,
// tension biases, flicker modifiers, recorders, state-field providers).
// GlobalConductorUpdate iterates these registries instead of probing 70+ typeof guards.

ConductorIntelligence = (() => {
  const V = Validator.create('ConductorIntelligence');

  // ── Density biases ────────────────────────────────────────────────
  // Each entry: { name, getter, lo, hi }
  // getter() returns a number; clamped to [lo, hi] then multiplied into targetDensity.
  /** @type {Array<{ name: string, getter: () => number, lo: number, hi: number }>} */
  const densityBiases = [];

  /**
   * Register a density-bias contributor.
   * @param {string} name — diagnostic label
   * @param {() => number} getter — returns bias multiplier (ideally near 1.0)
   * @param {number} lo — clamp minimum (e.g. 0.8)
   * @param {number} hi — clamp maximum (e.g. 1.2)
   */
  function registerDensityBias(name, getter, lo, hi) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    densityBiases.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all density biases */
  function collectDensityBias() {
    let product = 1;
    for (let i = 0; i < densityBiases.length; i++) {
      const entry = densityBiases[i];
      product *= clamp(entry.getter(), entry.lo, entry.hi);
    }
    return product;
  }

  // ── Tension biases ────────────────────────────────────────────────
  /** @type {Array<{ name: string, getter: () => number, lo: number, hi: number }>} */
  const tensionBiases = [];

  /**
   * Register a tension-bias contributor.
   * @param {string} name
   * @param {() => number} getter
   * @param {number} lo
   * @param {number} hi
   */
  function registerTensionBias(name, getter, lo, hi) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    tensionBiases.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all tension biases */
  function collectTensionBias() {
    let product = 1;
    for (let i = 0; i < tensionBiases.length; i++) {
      const entry = tensionBiases[i];
      product *= clamp(entry.getter(), entry.lo, entry.hi);
    }
    return product;
  }

  // ── Flicker modifiers ─────────────────────────────────────────────
  /** @type {Array<{ name: string, getter: () => number, lo: number, hi: number }>} */
  const flickerModifiers = [];

  /**
   * Register a flicker-amplitude modifier.
   * @param {string} name
   * @param {() => number} getter
   * @param {number} lo
   * @param {number} hi
   */
  function registerFlickerModifier(name, getter, lo, hi) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    flickerModifiers.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all flicker modifiers */
  function collectFlickerModifier() {
    let product = 1;
    for (let i = 0; i < flickerModifiers.length; i++) {
      const entry = flickerModifiers[i];
      product *= clamp(entry.getter(), entry.lo, entry.hi);
    }
    return product;
  }

  // ── Recorders ─────────────────────────────────────────────────────
  // Recorders receive a context object each beat and perform side-effects
  // (recording snapshots, updating internal state).
  /**
   * @typedef {{
   *   absTime: number,
   *   compositeIntensity: number,
   *   currentDensity: number,
   *   harmonicRhythm: number
   * }} RecorderContext
   */
  /** @type {Array<{ name: string, fn: (ctx: RecorderContext) => void }>} */
  const recorders = [];

  /**
   * Register a recorder that runs each beat.
   * @param {string} name
   * @param {(ctx: RecorderContext) => void} fn
   */
  function registerRecorder(name, fn) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(fn, 'function', 'fn');
    recorders.push({ name, fn });
  }

  /**
   * Run all recorders with the given context.
   * @param {RecorderContext} ctx
   */
  function runRecorders(ctx) {
    for (let i = 0; i < recorders.length; i++) {
      recorders[i].fn(ctx);
    }
  }

  // ── State-field providers ─────────────────────────────────────────
  // Each provider returns an object whose keys map directly to
  // ConductorState.updateFromConductor() fields.
  /** @type {Array<{ name: string, getter: () => Record<string, any> }>} */
  const stateProviders = [];

  /**
   * Register a state-field provider.
   * @param {string} name
   * @param {() => Record<string, any>} getter — returns a flat object of ConductorState fields
   */
  function registerStateProvider(name, getter) {
    V.assertNonEmptyString(name, 'name');
    V.requireType(getter, 'function', 'getter');
    stateProviders.push({ name, getter });
  }

  /**
   * Collect all state fields by merging provider outputs.
   * @returns {Record<string, any>}
   */
  function collectStateFields() {
    const merged = {};
    for (let i = 0; i < stateProviders.length; i++) {
      const fields = stateProviders[i].getter();
      if (fields && typeof fields === 'object') {
        Object.assign(merged, fields);
      }
    }
    return merged;
  }

  // ── Diagnostics ───────────────────────────────────────────────────
  /** @returns {{ density: number, tension: number, flicker: number, recorders: number, stateProviders: number }} */
  function getCounts() {
    return {
      density: densityBiases.length,
      tension: tensionBiases.length,
      flicker: flickerModifiers.length,
      recorders: recorders.length,
      stateProviders: stateProviders.length
    };
  }

  return {
    registerDensityBias,
    collectDensityBias,
    registerTensionBias,
    collectTensionBias,
    registerFlickerModifier,
    collectFlickerModifier,
    registerRecorder,
    runRecorders,
    registerStateProvider,
    collectStateFields,
    getCounts
  };
})();
