

/**
 * Harmonic Function Graph (E1)
 *
 * Maps each chord root + quality to a tonal function (Tonic / Subdominant /
 * Dominant / Ambiguous) within the current key context. Registers a
 * tension bias that rises on dominant-function chords and relaxes on tonics.
 *
 * Also posts function labels to L0 channel 'harmonicFunction'
 * so cross-layer modules can reason about harmonic trajectory.
 */

moduleLifecycle.declare({
  name: 'harmonicFunctionGraph',
  subsystem: 'conductor',
  deps: ['L0', 'conductorIntelligence', 'validator'],
  provides: ['harmonicFunctionGraph'],
  init: (deps) => {
  const L0 = deps.L0;
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('harmonicFunctionGraph');

  const CHANNEL = 'harmonicFunction';

  // Scale-degree - function mapping (major-key defaults).
  // 0-indexed from root of current key.
  const DEGREE_FUNCTION = {
    0: 'T',   // I   - tonic
    1: 'S',   // ii  - subdominant
    2: 'T',   // iii - tonic substitute
    3: 'S',   // IV  - subdominant
    4: 'D',   // V   - dominant
    5: 'S',   // vi  - subdominant (tonic substitute in some analyses)
    6: 'D',   // vii - dominant
  };

  const FUNCTION_TENSION = {
    'T': 0.96,
    'S': 1.00,
    'D': 1.06,
    'A': 1.02,  // ambiguous
  };

  let currentFunction = 'T';
  let tensionVal = 1.0;

  /**
   * Resolve harmonic function for a given chord root relative to key root.
   * @param {number} chordRoot  MIDI pitch class 0-11
   * @param {number} keyRoot    MIDI pitch class 0-11
   * @returns {string} 'T' | 'S' | 'D' | 'A'
   */
  function classify(chordRoot, keyRoot) {
    const degree = ((chordRoot - keyRoot) % 12 + 12) % 12;
    // Map chromatic interval to diatonic degree (major scale).
    const chromaticToDiatonic = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
    const diatonic = chromaticToDiatonic[degree];
    if (diatonic === undefined) return 'A';
    return DEGREE_FUNCTION[diatonic] || 'A';
  }

  function refresh() {
    const chordRoot = V.optionalFinite(conductorState.get('tension'), 0);
    const keyStr = conductorState.get('key') || 'C';
    // Derive numeric root from key name via tonal
    const keyRoot = V.optionalFinite(t.Note.chroma(keyStr), 0);

    currentFunction = classify(chordRoot, keyRoot);
    tensionVal = V.requireFinite(FUNCTION_TENSION[currentFunction], "FUNCTION_TENSION[" + currentFunction + "]");

    const nowMs = V.optionalFinite(conductorState.get('tick'), 0);
    L0.post(CHANNEL, '0', nowMs / 1000, {
      fn: currentFunction,
      chordRoot,
      keyRoot,
    });
  }

  function tensionBias() { return tensionVal; }
  function getFunction() { return currentFunction; }

  function reset() {
    currentFunction = 'T';
    tensionVal = 1.0;
  }

  // Self-registration
  conductorIntelligence.registerTensionBias('harmonicFunctionGraph', tensionBias, 0.92, 1.10);
  conductorIntelligence.registerRecorder('harmonicFunctionGraph', refresh);
  conductorIntelligence.registerStateProvider('harmonicFunctionGraph', () => ({
    harmonicFunction: currentFunction,
  }));
  conductorIntelligence.registerModule('harmonicFunctionGraph', { reset }, ['section']);

  return { classify, getFunction, tensionBias, reset };
  },
});
