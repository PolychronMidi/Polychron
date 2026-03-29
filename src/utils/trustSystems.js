// trustSystems.js - Canonical trust system name constants.
// Eliminates hardcoded trust key strings scattered across negotiationEngine,
// crossLayerBeatRecord, interactionHeatMap, and config.js.
// Follows the eventCatalog pattern: frozen enum validated at boot.

trustSystems = (() => {
  const V = validator.create('trustSystems');

  // -- Scored trust systems (adaptiveTrustScores tracks these) --
  const names = Object.freeze({
    STUTTER_CONTAGION: 'stutterContagion',
    PHASE_LOCK: 'phaseLock',
    CADENCE_ALIGNMENT: 'cadenceAlignment',
    CONVERGENCE: 'convergence',
    FEEDBACK_OSCILLATOR: 'feedbackOscillator',
    COHERENCE_MONITOR: 'coherenceMonitor',
    ENTROPY_REGULATOR: 'entropyRegulator',
    REST_SYNCHRONIZER: 'restSynchronizer',
    ROLE_SWAP: 'roleSwap',
    GROOVE_TRANSFER: 'grooveTransfer',
    VELOCITY_INTERFERENCE: 'velocityInterference',
    HARMONIC_INTERVAL_GUARD: 'harmonicIntervalGuard',
    EMERGENT_DOWNBEAT: 'emergentDownbeat',
    ARTICULATION_COMPLEMENT: 'articulationComplement',
    TEXTURAL_MIRROR: 'texturalMirror'
  });

  // -- Heat map system names (superset - includes non-trust systems tracked by interactionHeatMap) --
  const heatMapSystems = Object.freeze({
    STUTTER_CONTAGION: 'stutterContagion',
    CONVERGENCE: 'convergence',
    TEMPORAL_GRAVITY: 'temporalGravity',
    VELOCITY_INTERFERENCE: 'velocityInterference',
    FEEDBACK_OSCILLATOR: 'feedbackOscillator',
    CADENCE_ALIGNMENT: 'cadenceAlignment',
    PHASE_LOCK: 'phaseLock',
    SPECTRAL_COMPLEMENT: 'spectralComplement',
    ROLE_SWAP: 'roleSwap',
    MOTIF_ECHO: 'motifEcho',
    EMERGENT_DOWNBEAT: 'emergentDownbeat',
    CLIMAX_ENGINE: 'climaxEngine',
    REST_SYNC: 'restSync'
  });

  /**
   * Get the frozen trust system names object.
   * @returns {Readonly<typeof names>}
   */
  function getNames() {
    return names;
  }

  /**
   * Get the frozen heat map system names object.
   * @returns {Readonly<typeof heatMapSystems>}
   */
  function getHeatMapSystems() {
    return heatMapSystems;
  }

  /**
   * Validate that a string is a known trust system name.
   * Throws if the name is not in the canonical list.
   * @param {string} name
   * @param {string} label - context for error message
   */
  function assertKnownTrustSystem(name, label) {
    V.assertNonEmptyString(name, label);
    const values = /** @type {string[]} */ (Object.values(names));
    if (!values.includes(name)) {
      throw new Error(`trustSystems: unknown trust system "${name}" at ${label}. Known: ${values.join(', ')}`);
    }
  }

  /**
   * Validate that a string is a known heat map system name.
   * @param {string} name
   * @param {string} label
   */
  function assertKnownHeatMapSystem(name, label) {
    V.assertNonEmptyString(name, label);
    const values = /** @type {string[]} */ (Object.values(heatMapSystems));
    if (!values.includes(name)) {
      throw new Error(`trustSystems: unknown heat map system "${name}" at ${label}. Known: ${values.join(', ')}`);
    }
  }

  return { names, heatMapSystems, getNames, getHeatMapSystems, assertKnownTrustSystem, assertKnownHeatMapSystem };
})();
