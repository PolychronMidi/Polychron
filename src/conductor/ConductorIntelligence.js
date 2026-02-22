// src/conductor/ConductorIntelligence.js — Registry for conductor intelligence modules.
// Each intelligence module self-registers its contributions (density biases,
// tension biases, flicker modifiers, recorders, state-field providers).
// GlobalConductorUpdate iterates these registries instead of probing 70+ typeof guards.

ConductorIntelligence = (() => {
  const V = Validator.create('ConductorIntelligence');

  // ── Lifecycle (shared with CrossLayerRegistry via ModuleLifecycle) ─────
  const lifecycle = ModuleLifecycle.create('ConductorIntelligence');
  let _initialized = false;

  /**
   * Register a module for scoped lifecycle resets (section, phrase, all).
   * Call alongside registerDensityBias/registerRecorder/etc. so new modules
   * self-declare their lifecycle without editing a hardcoded list.
   * @param {string} name
   * @param {{ reset: function }} mod
   * @param {Array<'all'|'section'|'phrase'>} scopes
   */
  function registerModule(name, mod, scopes) {
    lifecycle.register(name, mod, scopes);
  }

  /** Subscribe lifecycle resets to SECTION_BOUNDARY. Call once from main.js. */
  function initialize() {
    if (_initialized) return;
    _initialized = true;
    const EVENTS = V.getEventsOrThrow();
    EventBus.on(EVENTS.SECTION_BOUNDARY, () => lifecycle.resetSection());
  }

  // ── Shared collection helpers ─────────────────────────────────────
  /** @param {Array<{ getter: () => number, lo: number, hi: number }>} registry @returns {number} */
  function _collect(registry) {
    let product = 1;
    for (let i = 0; i < registry.length; i++) {
      product *= clamp(registry[i].getter(), registry[i].lo, registry[i].hi);
    }
    return product;
  }

  /**
   * @param {Array<{ name: string, getter: () => number, lo: number, hi: number }>} registry
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function _collectWithAttribution(registry) {
    let product = 1;
    const contributions = [];
    for (let i = 0; i < registry.length; i++) {
      const entry = registry[i];
      const raw = entry.getter();
      const clamped = clamp(raw, entry.lo, entry.hi);
      product *= clamped;
      contributions.push({ name: entry.name, raw, clamped });
    }
    return { product, contributions };
  }

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
  function collectDensityBias() { return _collect(densityBiases); }

  /** @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectDensityBiasWithAttribution() { return _collectWithAttribution(densityBiases); }

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
  function collectTensionBias() { return _collect(tensionBiases); }

  /** @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectTensionBiasWithAttribution() { return _collectWithAttribution(tensionBiases); }

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
  function collectFlickerModifier() { return _collect(flickerModifiers); }

  /** @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectFlickerModifierWithAttribution() { return _collectWithAttribution(flickerModifiers); }

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

  /**
   * Frozen snapshot of all current signal products and state fields.
   * Intended for cross-module reading (e.g., feedback loops, diagnostics).
   * @returns {Readonly<{ densityProduct: number, tensionProduct: number, flickerProduct: number, stateFields: Record<string, any>, counts: Record<string, number> }>}
   */
  function getSignalSnapshot() {
    return Object.freeze({
      densityProduct: collectDensityBias(),
      tensionProduct: collectTensionBias(),
      flickerProduct: collectFlickerModifier(),
      stateFields: collectStateFields(),
      counts: getCounts()
    });
  }

  return {
    // lifecycle
    registerModule,
    initialize,
    resetSection: lifecycle.resetSection,
    resetPhrase: lifecycle.resetPhrase,
    getModuleNames: lifecycle.getNames,
    getModuleCount: lifecycle.getCount,
    // contribution registries
    registerDensityBias,
    collectDensityBias,
    collectDensityBiasWithAttribution,
    registerTensionBias,
    collectTensionBias,
    collectTensionBiasWithAttribution,
    registerFlickerModifier,
    collectFlickerModifier,
    collectFlickerModifierWithAttribution,
    registerRecorder,
    runRecorders,
    registerStateProvider,
    collectStateFields,
    getCounts,
    getSignalSnapshot
  };
})();
