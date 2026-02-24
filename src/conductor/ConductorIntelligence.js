// src/conductor/ConductorIntelligence.js â€” Registry for conductor intelligence modules.
// Each intelligence module self-registers its contributions (density biases,
// tension biases, flicker modifiers, recorders, state-field providers).
// GlobalConductorUpdate iterates these registries instead of probing 70+ typeof guards.

ConductorIntelligence = (() => {
  const V = Validator.create('conductorIntelligence');

  // â”€â”€ Lifecycle (shared with CrossLayerRegistry via ModuleLifecycle) â”€â”€â”€â”€â”€
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

  // â”€â”€ Shared collection helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Dampening factor: shrinks deviations from 1.0 before multiplying,
  // preventing 23 contributors from crushing the product to near-zero.
  // A clamped value of 0.75 becomes 1.0 + (0.75 - 1.0) * 0.6 = 0.85.
  const DENSITY_DEVIATION_DAMPING = 0.6;

  /** @param {number} clamped @returns {number} */
  function _dampen(clamped) {
    return 1.0 + (clamped - 1.0) * DENSITY_DEVIATION_DAMPING;
  }

  /** Applies deviation dampening to all pipelines (density, tension, flicker). */
  function _collectDampened(registry) {
    let product = 1;
    for (let i = 0; i < registry.length; i++) {
      product *= _dampen(clamp(registry[i].getter(), registry[i].lo, registry[i].hi));
    }
    return product;
  }

  /** Like _collectDampened but with per-contributor attribution. */
  function _collectDampenedWithAttribution(registry) {
    let product = 1;
    const contributions = [];
    for (let i = 0; i < registry.length; i++) {
      const entry = registry[i];
      const raw = entry.getter();
      const clamped = clamp(raw, entry.lo, entry.hi);
      product *= _dampen(clamped);
      contributions.push({ name: entry.name, raw, clamped });
    }
    return { product, contributions };
  }

  /** @param {Array<{ name: string }>} registry @param {string} name @param {string} kind */
  function _assertNoDuplicateName(registry, name, kind) {
    if (registry.some(e => e.name === name)) {
      throw new Error(`ConductorIntelligence.register${kind}: duplicate name "${name}"`);
    }
  }

  // â”€â”€ Density biases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Each entry: { name, getter, lo, hi }
  // getter() returns a number; clamped to [lo, hi] then multiplied into targetDensity.
  /** @type {Array<{ name: string, getter: () => number, lo: number, hi: number }>} */
  const densityBiases = [];

  /**
   * Register a density-bias contributor.
   * @param {string} name â€” diagnostic label
   * @param {() => number} getter â€” returns bias multiplier (ideally near 1.0)
   * @param {number} lo â€” clamp minimum (e.g. 0.8)
   * @param {number} hi â€” clamp maximum (e.g. 1.2)
   */
  function registerDensityBias(name, getter, lo, hi) {
    V.assertNonEmptyString(name, 'name');
    _assertNoDuplicateName(densityBiases, name, 'densityBias');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    densityBiases.push({ name, getter, lo, hi });
  }

  const DENSITY_PRODUCT_FLOOR = 0.30;
  const TENSION_PRODUCT_CEILING = 1.6;

  /** @returns {number} product of all density biases (dampened + floored to prevent crush) */
  function collectDensityBias() { return m.max(_collectDampened(densityBiases), DENSITY_PRODUCT_FLOOR); }

  /** @returns {{ product: number, rawProduct: number, floored: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectDensityBiasWithAttribution() {
    const result = _collectDampenedWithAttribution(densityBiases);
    const rawProduct = result.product;
    return {
      product: m.max(rawProduct, DENSITY_PRODUCT_FLOOR),
      rawProduct,
      floored: rawProduct < DENSITY_PRODUCT_FLOOR,
      contributions: result.contributions
    };
  }

  // â”€â”€ Tension biases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    _assertNoDuplicateName(tensionBiases, name, 'tensionBias');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    tensionBiases.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all tension biases (dampened + capped to prevent saturation) */
  function collectTensionBias() { return m.min(_collectDampened(tensionBiases), TENSION_PRODUCT_CEILING); }

  /** @returns {{ product: number, rawProduct: number, capped: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectTensionBiasWithAttribution() {
    const result = _collectDampenedWithAttribution(tensionBiases);
    const rawProduct = result.product;
    return {
      product: m.min(rawProduct, TENSION_PRODUCT_CEILING),
      rawProduct,
      capped: rawProduct > TENSION_PRODUCT_CEILING,
      contributions: result.contributions
    };
  }

  // â”€â”€ Flicker modifiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    _assertNoDuplicateName(flickerModifiers, name, 'flickerModifier');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    flickerModifiers.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all flicker modifiers (dampened to prevent crush) */
  function collectFlickerModifier() { return _collectDampened(flickerModifiers); }

  /** @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectFlickerModifierWithAttribution() { return _collectDampenedWithAttribution(flickerModifiers); }

  // â”€â”€ Recorders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    _assertNoDuplicateName(recorders, name, 'recorder');
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

  // â”€â”€ State-field providers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Each provider returns an object whose keys map directly to
  // ConductorState.updateFromConductor() fields.
  //
  // IMPORTANT: Most stateProvider fields are NOT individually consumed today.
  // Only 4 fields have confirmed consumers (profileHintRestrained,
  // profileHintExplosive, profileHintAtmospheric via conductorConfigAccessors,
  // and coherenceEntropy via conductorSignalBridge).
  // The remaining ~90 fields flow into ConductorState bulk snapshots and
  // ExplainabilityBus telemetry. They exist as typed observation points â€”
  // wire a consumer before assuming they influence behavior.
  /** @type {Array<{ name: string, getter: () => Record<string, any> }>} */
  const stateProviders = [];

  /**
   * Register a state-field provider.
   *
   * STATE FIELD CONSUMPTION AUDIT (50 providers, 9 directly consumed fields):
   *
   * Fields consumed by ConductorState.getField(name):
   *   sectionPhase         â†’ TempoFeelEngine, main.js
   *   compositeIntensity   â†’ HarmonicVelocityMonitor, main.js (Ã—2), playNotes, processBeat
   *   phrasePosition       â†’ TextureBlender
   *   phrasePhase          â†’ TextureBlender
   *   key                  â†’ main.js
   *   mode                 â†’ main.js
   *
   * Fields consumed by signalReader.state(name):
   *   profileHintRestrained  â†’ conductorConfigAccessors
   *   profileHintExplosive   â†’ conductorConfigAccessors
   *   profileHintAtmospheric â†’ conductorConfigAccessors
   *
   * All other ~90+ fields are observation-point only: visible in bulk
   * ConductorState.getSnapshot() (consumed by playDrums, playDrums2, drummer,
   * setBinaural, SystemSnapshot, HarmonicContext, conductorSignalBridge) but
   * never individually queried by name. This is by design â€” stateProviders act
   * as a passive telemetry layer for diagnostic and snapshot consumers.
   *
   * @param {string} name
   * @param {() => Record<string, any>} getter â€” returns a flat object of ConductorState fields
   */
  function registerStateProvider(name, getter) {
    V.assertNonEmptyString(name, 'name');
    _assertNoDuplicateName(stateProviders, name, 'stateProvider');
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

  // â”€â”€ Diagnostics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Return every unique name that has registered any contribution
   * (density, tension, flicker, recorder, or stateProvider).
   * Strips colon-suffixed variants (e.g. 'Foo:bar' â†’ 'Foo') so that
   * modules registering multiple biases under sub-labels are unified.
   * @returns {string[]}
   */
  function getContributorNames() {
    const raw = new Set();
    densityBiases.forEach(e => raw.add(e.name));
    tensionBiases.forEach(e => raw.add(e.name));
    flickerModifiers.forEach(e => raw.add(e.name));
    recorders.forEach(e => raw.add(e.name));
    stateProviders.forEach(e => raw.add(e.name));
    // Normalize colon-qualified labels to their base module name
    const normalized = new Set();
    raw.forEach(n => normalized.add(n.split(':')[0]));
    return Array.from(normalized).sort();
  }

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
    getContributorNames,
    getCounts,
    getSignalSnapshot
  };
})();
