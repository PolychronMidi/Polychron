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

  // Shared collection helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Dampening factor: shrinks deviations from 1.0 before multiplying,
  // preventing many contributors from crushing the product to near-zero.
  // Auto-scaled per pipeline: base damping (0.6) calibrated for ~20
  // contributors. Smaller pipelines get proportionally less pass-through
  // so each module's deviation is attenuated more, reducing volatility.
  const BASE_DEVIATION_DAMPING = 0.6;
  const REF_PIPELINE_SIZE = 20;

  /** Compute effective damping scaled by pipeline contributor count and system dynamics. */
  function _scaledDamping(registryLength) {
    let base = BASE_DEVIATION_DAMPING;
    try {
      const snap = systemDynamicsProfiler.getSnapshot();
      if (snap.regime === 'fragmented' || snap.regime === 'oscillating') {
        base *= 0.8; // Thicken gravity (less pass-through) when fragmented
      } else if (snap.regime === 'exploring' || snap.regime === 'coherent') {
        base *= 1.2; // Loosen gravity (more pass-through) when coherent
      }
    } catch { /* ignore */ }
    return clamp(base * clamp(registryLength / REF_PIPELINE_SIZE, 0.3, 1.0), 0.1, 1.0);
  }

  // Progressive dampening: as the running product diverges from 1.0,
  // subsequent deviations in the same direction face stronger dampening.
  // This prevents coordinated crush (10 modules each pulling to 0.85–0.94)
  // from accumulating catastrophic suppression, without touching any
  // individual module's response. Deviations opposing the running product
  // are given lighter dampening to encourage self-correction.
  const PROGRESSIVE_STRENGTH = 0.50; // softened (was 0.55) — density crush still 37% with 3 pinned modules

  /**
   * Compute progressive dampening factor for a single contributor.
   * @param {number} clamped - contributor's clamped bias value
   * @param {number} baseDamping - pipeline-scaled base dampening
   * @param {number} runningProduct - product so far (before this contributor)
   * @returns {number} dampened value
   */
  function _progressiveDampen(clamped, baseDamping, runningProduct) {
    const deviation = clamped - 1.0;
    if (m.abs(deviation) < 1e-6) return 1.0;

    let progStrength = PROGRESSIVE_STRENGTH;
    try {
      const snap = systemDynamicsProfiler.getSnapshot();
      if (snap.effectiveDimensionality < 2.0) {
        progStrength *= 1.5; // Stronger resistance to crush if dimensionality is collapsing
      }
    } catch { /* ignore */ }

    // Is this deviation pushing the product further from 1.0?
    const productDeviation = runningProduct - 1.0;
    const sameDirection = (deviation < 0 && productDeviation < 0) || (deviation > 0 && productDeviation > 0);
    // Ramp: product at 0.6 → extra dampening 0.2; product at 0.5 → extra 0.25
    const drift = m.abs(productDeviation);
    const extraDampening = sameDirection ? progStrength * clamp(drift, 0, 0.5) : 0;
    const effectiveDamping = clamp(baseDamping - extraDampening, 0.15, baseDamping);
    return 1.0 + deviation * effectiveDamping;
  }

  /** Applies progressive deviation dampening to all pipelines (density, tension, flicker). */
  function _collectDampened(registry) {
    const damping = _scaledDamping(registry.length);
    let product = 1;
    for (let i = 0; i < registry.length; i++) {
      product *= _progressiveDampen(clamp(registry[i].getter(), registry[i].lo, registry[i].hi), damping, product);
    }
    return product;
  }

  /** Like _collectDampened but with per-contributor attribution. */
  function _collectDampenedWithAttribution(registry) {
    const damping = _scaledDamping(registry.length);
    let product = 1;
    const contributions = [];
    for (let i = 0; i < registry.length; i++) {
      const entry = registry[i];
      const raw = entry.getter();
      const clamped = clamp(raw, entry.lo, entry.hi);
      product *= _progressiveDampen(clamped, damping, product);
      contributions.push({ name: entry.name, raw, clamped });
    }
    return { product, contributions };
  }

  /** @param {Array<{ name: string }>} registry @param {string} name @param {string} kind */
  function _assertNoDuplicateName(registry, name, kind) {
    if (registry.some(e => e.name === name)) {
      throw new Error(`conductorIntelligence.register${kind}: duplicate name "${name}"`);
    }
  }

  // Density biases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  function collectDensityBias() { return pipelineNormalizer.normalize('density', _collectDampened(densityBiases)); }

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

  // Tension biases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // Flicker modifiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  function collectFlickerModifier() { return pipelineNormalizer.normalize('flicker', _collectDampened(flickerModifiers)); }

  /** @returns {{ product: number, rawProduct: number, floored: boolean, capped: boolean, contributions: Array<{ name: string, raw: number, clamped: number }> }} */
  function collectFlickerModifierWithAttribution() {
    const result = _collectDampenedWithAttribution(flickerModifiers);
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

  // Recorders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // State-field providers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
   *   sectionPhase         â†’ tempoFeelEngine, main.js
   *   compositeIntensity   â†’ harmonicVelocityMonitor, main.js (Ã—2), playNotes, processBeat
   *   phrasePosition       â†’ textureBlender
   *   phrasePhase          â†’ textureBlender
   *   key                  â†’ main.js
   *   mode                 â†’ main.js
   *
   * Fields consumed by signalReader.state(name):
   *   profileHintRestrained  â†’ conductorConfigAccessors
   *   profileHintExplosive   â†’ conductorConfigAccessors
   *   profileHintAtmospheric â†’ conductorConfigAccessors
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

  // Diagnostics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    getSignalSnapshot
  };
})();
