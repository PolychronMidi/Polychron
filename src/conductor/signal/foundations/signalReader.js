// signalReader.js - Standardized read API for the conductor signal pipeline.
// Provides a thin, stable interface for any module to read density/tension/flicker
// products, state-provider fields, signal attribution, and explainabilityBus events.
// All inter-module signal reading goes through signalReader - never call
// conductorIntelligence.getSignalSnapshot() or explainabilityBus.queryByType() directly.

moduleLifecycle.declare({
  name: 'signalReader',
  subsystem: 'conductor',
  // Full-DI deps: conductorIntelligence + explainabilityBus are aliased
  // as locals below so query methods reference deps.X via the local name.
  // conductorIntelligence is itself a registerInitializer-pool module
  // (loaded at IIFE time before signalReader.declare runs), so the
  // dependency resolves eagerly without deferral.
  deps: ['validator', 'conductorIntelligence', 'explainabilityBus'],
  provides: ['signalReader'],
  init: (deps) => {
  const V = deps.validator.create('signalReader');
  void V;
  // Full-DI aliases.
  const conductorIntelligence = deps.conductorIntelligence;
  const explainabilityBus = deps.explainabilityBus;

  /** @returns {number} Product of all registered density biases. */
  function density() {
    return conductorIntelligence.collectDensityBias();
  }

  /** @returns {number} Product of all registered tension biases. */
  function tension() {
    return conductorIntelligence.collectTensionBias();
  }

  /** @returns {number} Product of all registered flicker modifiers. */
  function flicker() {
    return conductorIntelligence.collectFlickerModifier();
  }

  /**
   * Read a single state-provider field from the merged snapshot.
   * @param {string} field
   * @returns {any}
   */
  function state(field) {
    V.assertNonEmptyString(field, 'field');
    return conductorIntelligence.collectStateFields()[field];
  }

  /**
   * Read the full frozen signal snapshot.
   * @returns {Readonly<{ densityProduct: number, tensionProduct: number, flickerProduct: number, stateFields: Record<string, any>, counts: Record<string, number> }>}
   */
  function snapshot() {
    return conductorIntelligence.getSignalSnapshot();
  }

  /**
   * Read the attributed density breakdown: product + per-module contributions.
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function densityAttribution() {
    return conductorIntelligence.collectDensityBiasWithAttribution();
  }

  /**
   * Read the attributed tension breakdown.
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function tensionAttribution() {
    return conductorIntelligence.collectTensionBiasWithAttribution();
  }

  /**
   * Read the attributed flicker breakdown.
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function flickerAttribution() {
    return conductorIntelligence.collectFlickerModifierWithAttribution();
  }

  /**
   * Query recent explainabilityBus events by type.
   * Load-order note: explainabilityBus is registered in crossLayer (loads after conductor).
   * This call is safe at runtime (beat-processing time) but must NOT be invoked at module
   * load time - the global will not yet exist.
   * @param {string} type - event type to filter on
   * @param {number} [limit=10]
   * @returns {Array<{ type: string, layer: string, payload: any, absoluteSeconds: number }>}
   */
  function recentEvents(type, limit) {
    V.assertNonEmptyString(type, 'type');
    return explainabilityBus.queryByType(type, limit ?? 10);
  }

  return {
    density,
    tension,
    flicker,
    state,
    snapshot,
    densityAttribution,
    tensionAttribution,
    flickerAttribution,
    recentEvents
  };
  },
});
