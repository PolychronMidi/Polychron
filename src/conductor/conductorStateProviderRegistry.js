// src/conductor/conductorStateProviderRegistry.js - Sub-registry for state-field providers.
// Each provider returns an object whose keys map directly to
// conductorState.updateFromConductor() fields.

conductorStateProviderRegistry = (() => {
  const V = validator.create('conductorStateProviderRegistry');

  /** @type {Array<{ name: string, getter: () => Record<string, any> }>} */
  const stateProviders = [];

  /** @param {string} name */
  function _assertNoDup(name) {
    if (stateProviders.some(e => e.name === name)) {
      throw new Error(`conductorStateProviderRegistry.registerStateProvider: duplicate name "${name}"`);
    }
  }

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
    _assertNoDup(name);
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

  /** @returns {string[]} raw entry names (not colon-normalized) */
  function getNames() {
    return stateProviders.map(e => e.name);
  }

  /** @returns {number} */
  function getCount() {
    return stateProviders.length;
  }

  return { registerStateProvider, collectStateFields, getNames, getCount };
})();
