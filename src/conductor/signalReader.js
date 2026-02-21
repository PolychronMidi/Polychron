// signalReader.js — Standardized read API for the conductor signal pipeline.
// Provides a thin, stable interface for any module to read density/tension/flicker
// products, state-provider fields, signal attribution, and ExplainabilityBus events.
// All inter-module signal reading goes through signalReader — never call
// ConductorIntelligence.getSignalSnapshot() or ExplainabilityBus.queryByType() directly.

signalReader = (() => {
  const V = Validator.create('signalReader');

  /** @returns {number} Product of all registered density biases. */
  function density() {
    return ConductorIntelligence.collectDensityBias();
  }

  /** @returns {number} Product of all registered tension biases. */
  function tension() {
    return ConductorIntelligence.collectTensionBias();
  }

  /** @returns {number} Product of all registered flicker modifiers. */
  function flicker() {
    return ConductorIntelligence.collectFlickerModifier();
  }

  /**
   * Read a single state-provider field from the merged snapshot.
   * @param {string} field
   * @returns {any}
   */
  function state(field) {
    V.assertNonEmptyString(field, 'field');
    return ConductorIntelligence.collectStateFields()[field];
  }

  /**
   * Read the full frozen signal snapshot.
   * @returns {Readonly<{ densityProduct: number, tensionProduct: number, flickerProduct: number, stateFields: Record<string, any>, counts: Record<string, number> }>}
   */
  function snapshot() {
    return ConductorIntelligence.getSignalSnapshot();
  }

  /**
   * Read the attributed density breakdown: product + per-module contributions.
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function densityAttribution() {
    return ConductorIntelligence.collectDensityBiasWithAttribution();
  }

  /**
   * Read the attributed tension breakdown.
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function tensionAttribution() {
    return ConductorIntelligence.collectTensionBiasWithAttribution();
  }

  /**
   * Read the attributed flicker breakdown.
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function flickerAttribution() {
    return ConductorIntelligence.collectFlickerModifierWithAttribution();
  }

  /**
   * Query recent ExplainabilityBus events by type.
   * Load-order note: ExplainabilityBus is registered in crossLayer (loads after conductor).
   * This call is safe at runtime (beat-processing time) but must NOT be invoked at module
   * load time — the global will not yet exist.
   * @param {string} type — event type to filter on
   * @param {number} [limit=10]
   * @returns {Array<{ type: string, layer: string, payload: any, absTimeMs: number }>}
   */
  function recentEvents(type, limit) {
    V.assertNonEmptyString(type, 'type');
    return ExplainabilityBus.queryByType(type, limit ?? 10);
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
})();
