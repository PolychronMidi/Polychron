// src/conductor/conductorIntelligence.js - Registry for conductor intelligence modules.
// Each intelligence module self-registers its contributions (density biases,
// tension biases, flicker modifiers, recorders, state-field providers).
// globalConductorUpdate iterates these registries instead of probing 70+ typeof guards.
//
// Sub-registries: conductorRecorderRegistry, conductorStateProviderRegistry
// Diagnostics: conductorDiagnostics (factory, created below)

moduleLifecycle.declare({
  name: 'conductorIntelligence',
  subsystem: 'conductor',
  // Full DI: eventBus needed for SECTION_BOUNDARY subscription wired inline.
  deps: ['eventBus', 'validator'],
  provides: ['conductorIntelligence'],
  init: (deps) => {
  const eventBus = deps.eventBus;
  const V = deps.validator.create('conductorIntelligence');

  // Lifecycle (shared with crossLayerRegistry via moduleLifecycle)
  const lifecycle = moduleLifecycle.create('conductorIntelligence');
  let conductorIntelligenceInitialized = false;

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
    if (conductorIntelligenceInitialized) return;
    conductorIntelligenceInitialized = true;
    const EVENTS = V.getEventsOrThrow();
    eventBus.on(EVENTS.SECTION_BOUNDARY, () => lifecycle.resetSection());
  }


  // Dampening engine - conductorDampening global

  /** @returns {number} */
  function conductorIntelligenceCollectDampened(registry, pipelineName) {
    return conductorDampening.collectDampened(registry, pipelineName);
  }

  /** @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function conductorIntelligenceCollectDampenedWithAttribution(registry, pipelineName) {
    return conductorDampening.collectDampenedWithAttribution(registry, pipelineName);
  }

  /** @param {Array<{ name: string }>} registry @param {string} name @param {string} kind */
  function conductorIntelligenceAssertNoDuplicateName(registry, name, kind) {
    if (registry.some(e => e.name === name)) {
      throw new Error(`conductorIntelligence.register${kind}: duplicate name "${name}"`);
    }
  }

  // Density biases
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
    conductorIntelligenceAssertNoDuplicateName(densityBiases, name, 'densityBias');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    densityBiases.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all density biases (dampened + soft-envelope normalized) */
  function collectDensityBias() {
    return pipelineNormalizer.normalize('density', conductorIntelligenceCollectDampened(densityBiases));
  }

  /** @returns {{ product: number, rawProduct: number, floored: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectDensityBiasWithAttribution() {
    const result = conductorIntelligenceCollectDampenedWithAttribution(densityBiases);
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
    conductorIntelligenceAssertNoDuplicateName(tensionBiases, name, 'tensionBias');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    tensionBiases.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all tension biases (dampened + soft-envelope normalized) */
  function collectTensionBias() { return pipelineNormalizer.normalize('tension', conductorIntelligenceCollectDampened(tensionBiases)); }

  /** @returns {{ product: number, rawProduct: number, capped: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectTensionBiasWithAttribution() {
    const result = conductorIntelligenceCollectDampenedWithAttribution(tensionBiases);
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
    conductorIntelligenceAssertNoDuplicateName(flickerModifiers, name, 'flickerModifier');
    V.requireType(getter, 'function', 'getter');
    V.requireFinite(lo, 'lo');
    V.requireFinite(hi, 'hi');
    flickerModifiers.push({ name, getter, lo, hi });
  }

  /** @returns {number} product of all flicker modifiers (dampened + soft-envelope normalized) */
  function collectFlickerModifier() {
    let raw = conductorIntelligenceCollectDampened(flickerModifiers, 'flicker');
    // Flicker Target Expansion in Evolving Regime
    const isEvolving = regimeClassifier.getRegime() === 'evolving';
    if (isEvolving) {
      raw *= 1.15;
    }
    return pipelineNormalizer.normalize('flicker', raw);
  }

  /** @returns {{ product: number, rawProduct: number, floored: boolean, capped: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectFlickerModifierWithAttribution() {
    const result = conductorIntelligenceCollectDampenedWithAttribution(flickerModifiers, 'flicker');
    let rawProduct = result.product;
    //  Flicker Target Expansion in Evolving Regime
    const isEvolving = regimeClassifier.getRegime() === 'evolving';
    if (isEvolving) {
      rawProduct *= 1.15;
    }
    const product = pipelineNormalizer.normalize('flicker', rawProduct);
    return {
      product,
      rawProduct,
      floored: product > rawProduct,
      capped: product < rawProduct,
      contributions: result.contributions
    };
  }

  // Diagnostics - created via conductorDiagnostics factory
  const diag = conductorDiagnostics.create(
    { density: densityBiases, tension: tensionBiases, flicker: flickerModifiers },
    { collectDensityBias, collectTensionBias, collectFlickerModifier }
  );


  initialize();
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
    // delegated to sub-registries
    registerRecorder: conductorRecorderRegistry.registerRecorder,
    runRecorders: conductorRecorderRegistry.runRecorders,
    registerStateProvider: conductorStateProviderRegistry.registerStateProvider,
    collectStateFields: conductorStateProviderRegistry.collectStateFields,
    // diagnostics
    getContributorNames: diag.getContributorNames,
    getCounts: diag.getCounts,
    getRegistryNames: diag.getRegistryNames,
    getSignalSnapshot: diag.getSignalSnapshot
  };
  },
});
