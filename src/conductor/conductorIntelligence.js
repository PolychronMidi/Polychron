// src/conductor/conductorIntelligence.js - Registry for conductor intelligence modules.
// Each intelligence module self-registers its contributions (density biases,
// tension biases, flicker modifiers, recorders, state-field providers).
// globalConductorUpdate iterates these registries instead of probing 70+ typeof guards.

conductorIntelligence = (() => {
  const V = validator.create('conductorIntelligence');

  // Lifecycle (shared with crossLayerRegistry via moduleLifecycle)
  const lifecycle = moduleLifecycle.create('conductorIntelligence');
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
    eventBus.on(EVENTS.SECTION_BOUNDARY, () => lifecycle.resetSection());
  }


  // Dampening engine - conductorDampening global

  /** @returns {number} */
  function _collectDampened(registry, pipelineName) {
    return conductorDampening.collectDampened(registry, pipelineName);
  }

  /** @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function _collectDampenedWithAttribution(registry, pipelineName) {
    return conductorDampening.collectDampenedWithAttribution(registry, pipelineName);
  }

  /** @param {Array<{ name: string }>} registry @param {string} name @param {string} kind */
  function _assertNoDuplicateName(registry, name, kind) {
    if (registry.some(e => e.name === name)) {
      throw new Error(`conductorIntelligence.register${kind}: duplicate name "${name}"`);
    }
  }

  // Density biases
  // Each entry: { name, getter, lo, hi }
  // getter() returns a number; clamped to [lo, hi] then multiplied into targetDensity.
  /** @type {Array<{ name: string, getter: () => number, lo: number, hi: number }>} */
  const densityBiases = [];

  /**
   * Register a density-bias contributor.
   * @param {string} name - diagnostic label
   * @param {() => number} getter - returns bias multiplier (ideally near 1.0)
   * @param {number} lo - clamp minimum (e.g. 0.8)
   * @param {number} hi - clamp maximum (e.g. 1.2)
   */
  function registerDensityBias(name, getter, lo, hi) {
    V.assertNonEmptyString(name, 'name');
    _assertNoDuplicateName(densityBiases, name, 'densityBias');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    densityBiases.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all density biases (dampened + soft-envelope normalized) */
  function collectDensityBias() {
    return pipelineNormalizer.normalize('density', _collectDampened(densityBiases));
  }

  /** @returns {{ product: number, rawProduct: number, floored: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectDensityBiasWithAttribution() {
    const result = _collectDampenedWithAttribution(densityBiases);
    const rawProduct = result.product;
    const product = pipelineNormalizer.normalize('density', rawProduct);
    return {
      product,
      rawProduct,
      floored: product > rawProduct,
      contributions: result.contributions
    };
  }

  // Tension biases
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

  /** @returns {number} product of all tension biases (dampened + soft-envelope normalized) */
  function collectTensionBias() { return pipelineNormalizer.normalize('tension', _collectDampened(tensionBiases)); }

  /** @returns {{ product: number, rawProduct: number, capped: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectTensionBiasWithAttribution() {
    const result = _collectDampenedWithAttribution(tensionBiases);
    const rawProduct = result.product;
    const product = pipelineNormalizer.normalize('tension', rawProduct);
    return {
      product,
      rawProduct,
      capped: product < rawProduct,
      contributions: result.contributions
    };
  }

  // Flicker modifiers
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

  /** @returns {number} product of all flicker modifiers (dampened + soft-envelope normalized) */
  function collectFlickerModifier() { return pipelineNormalizer.normalize('flicker', _collectDampened(flickerModifiers, 'flicker')); }

  /** @returns {{ product: number, rawProduct: number, floored: boolean, capped: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectFlickerModifierWithAttribution() {
    const result = _collectDampenedWithAttribution(flickerModifiers, 'flicker');
    const rawProduct = result.product;
    const product = pipelineNormalizer.normalize('flicker', rawProduct);
    return {
      product,
      rawProduct,
      floored: product > rawProduct,
      capped: product < rawProduct,
      contributions: result.contributions
    };
  }

  // Recorders
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

  // State-field providers
  // Each provider returns an object whose keys map directly to
  // conductorState.updateFromConductor() fields.
  //
  // IMPORTANT: Most stateProvider fields are NOT individually consumed today.
  // Only 4 fields have confirmed consumers (profileHintRestrained,
  // profileHintExplosive, profileHintAtmospheric via conductorConfigAccessors,
  // and coherenceEntropy via conductorSignalBridge).
  // The remaining ~90 fields flow into conductorState bulk snapshots and
  // explainabilityBus telemetry. They exist as typed observation points -
  // wire a consumer before assuming they influence behavior.
  /** @type {Array<{ name: string, getter: () => Record<string, any> }>} */
  const stateProviders = [];

  /**
   * Register a state-field provider.
   *
   * STATE FIELD CONSUMPTION AUDIT (50 providers, 9 directly consumed fields):
   *
   * Fields consumed by conductorState.getField(name):
   *   sectionPhase         - tempoFeelEngine, main.js
   *   compositeIntensity   - harmonicVelocityMonitor, main.js (x2), playNotes, processBeat
   *   phrasePosition       - textureBlender
   *   phrasePhase          - textureBlender
   *   key                  - main.js
   *   mode                 - main.js
   *
   * Fields consumed by signalReader.state(name):
   *   profileHintRestrained  - conductorConfigAccessors
   *   profileHintExplosive   - conductorConfigAccessors
   *   profileHintAtmospheric - conductorConfigAccessors
   *
   * All other ~90+ fields are observation-point only: visible in bulk
   * conductorState.getSnapshot() (consumed by playDrums, playDrums2, drummer,
   * setBinaural, systemSnapshot, harmonicContext, conductorSignalBridge) but
   * never individually queried by name. This is by design - stateProviders act
   * as a passive telemetry layer for diagnostic and snapshot consumers.
   *
   * @param {string} name
   * @param {() => Record<string, any>} getter - returns a flat object of conductorState fields
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

  // Diagnostics

  /**
   * Return every unique name that has registered any contribution
   * (density, tension, flicker, recorder, or stateProvider).
   * Strips colon-suffixed variants (e.g. 'Foo:bar' - 'Foo') so that
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
   * Get normalized contributor names for each registry bucket.
   * Colon-qualified labels are folded to base names (e.g. "Foo:bar" -> "Foo").
   * @returns {{ density: string[], tension: string[], flicker: string[], recorders: string[], stateProviders: string[] }}
   */
  function getRegistryNames() {
    /** @param {Array<{ name: string }>} registry */
    function namesFrom(registry) {
      const out = new Set();
      for (let i = 0; i < registry.length; i++) {
        out.add(registry[i].name.split(':')[0]);
      }
      return Array.from(out).sort();
    }

    return {
      density: namesFrom(densityBiases),
      tension: namesFrom(tensionBiases),
      flicker: namesFrom(flickerModifiers),
      recorders: namesFrom(recorders),
      stateProviders: namesFrom(stateProviders)
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

  moduleLifecycle.registerInitializer('conductorIntelligence', initialize);

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
    getRegistryNames,
    getSignalSnapshot
  };
})();
