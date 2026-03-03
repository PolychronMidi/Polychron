// src/crossLayer/crossLayerSilhouette.js - Holistic combined-output conductor.
// Observes the combined behavior of all cross-layer modules and produces
// correctional biases to keep the overall output balanced and musical.
// Consumes spectralComplementarity ATG 'spectral' channel (dead-end signal).
// Acts as the "meta-conductor" layer above individual cross-layer modules.

crossLayerSilhouette = (() => {
  const V = validator.create('crossLayerSilhouette');
  const SMOOTHING = 0.15;
  const ARC_HISTORY = 16;

  /** @type {{ density: number, register: number, dynamic: number, entropy: number, timeMs: number }[]} */
  const arcHistory = new Array(ARC_HISTORY).fill(null).map(() => ({ density: 0, register: 0, dynamic: 0, entropy: 0, timeMs: 0 }));
  let arcIndex = 0;
  let arcCount = 0;

  let smoothedDensity = 0.5;
  let smoothedRegister = 0.5;
  let smoothedDynamic = 0.5;
  let smoothedEntropy = 0.5;

  /**
   * Tick the silhouette analyzer each beat.
   * @param {number} absTimeMs
   * @param {string} [activeLayer='L1']
   */
  function tick(absTimeMs, activeLayer) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    const layerForSpectral = (typeof activeLayer === 'string' && activeLayer.length > 0) ? activeLayer : 'L1';

    // Gather all available signals

    // Density from entropyRegulator
    const entropyReg = entropyRegulator.getRegulation();

    // Register balance from spectralComplementarity (using active layer, not hardcoded)
    const spectralComplement = spectralComplementarity.analyzeComplement(layerForSpectral);

    // Heat from interactionHeatMap
    const heat = interactionHeatMap.getDensity();

    // Convergence intensity boosts dynamic reading
    const convergenceRecent = convergenceDetector.wasRecent(absTimeMs, 'L1', 500) || convergenceDetector.wasRecent(absTimeMs, 'L2', 500);

    // Compute raw metrics
    const rawDensity = clamp(heat, 0, 1);
    const rawRegister = clamp(spectralComplement.gapWeight, 0, 1);
    const rawDynamic = convergenceRecent ? 0.7 : 0.4;
    const rawEntropy = V.optionalFinite(entropyReg.currentEntropy, 0.5);

    // Smooth
    smoothedDensity = smoothedDensity * (1 - SMOOTHING) + rawDensity * SMOOTHING;
    smoothedRegister = smoothedRegister * (1 - SMOOTHING) + rawRegister * SMOOTHING;
    smoothedDynamic = smoothedDynamic * (1 - SMOOTHING) + rawDynamic * SMOOTHING;
    smoothedEntropy = smoothedEntropy * (1 - SMOOTHING) + rawEntropy * SMOOTHING;

    // Record arc history
    const entry = arcHistory[arcIndex];
    entry.density = smoothedDensity;
    entry.register = smoothedRegister;
    entry.dynamic = smoothedDynamic;
    entry.entropy = smoothedEntropy;
    entry.timeMs = absTimeMs;

    arcIndex = (arcIndex + 1) % ARC_HISTORY;
    if (arcCount < ARC_HISTORY) arcCount++;
  }

  /**
   * Get correctional biases to steer the combined output toward balance.
   * Positive bias = "increase this parameter", negative = "decrease".
   * @returns {{ densityBias: number, registerBias: number, dynamicBias: number, entropyBias: number }}
   */
  function getCorrections() {
    // Ideal: mid-range balanced output unless intent says otherwise
    const intent = sectionIntentCurves.getLastIntent();

    const targetDensity = V.optionalFinite(intent.densityTarget, 0.5);
    const targetEntropy = V.optionalFinite(intent.entropyTarget, 0.5);

    return {
      densityBias: clamp((targetDensity - smoothedDensity) * 0.5, -0.3, 0.3),
      registerBias: clamp((0.5 - smoothedRegister) * 0.4, -0.3, 0.3), // steer toward balanced register
      dynamicBias: clamp((0.6 - smoothedDynamic) * 0.3, -0.2, 0.2),
      entropyBias: clamp((targetEntropy - smoothedEntropy) * 0.4, -0.3, 0.3)
    };
  }

  /**
   * Get the current silhouette snapshot.
   * @returns {{ density: number, register: number, dynamic: number, entropy: number }}
   */
  function getSilhouette() {
    return {
      density: smoothedDensity,
      register: smoothedRegister,
      dynamic: smoothedDynamic,
      entropy: smoothedEntropy
    };
  }

  /**
   * Get the arc history for trend analysis.
   * @returns {{ density: number, register: number, dynamic: number, entropy: number, timeMs: number }[]}
   */
  function getSilhouetteArc() {
    const result = new Array(arcCount);
    for (let i = 0; i < arcCount; i++) {
        result[i] = Object.assign({}, arcHistory[(arcIndex - arcCount + i + ARC_HISTORY) % ARC_HISTORY]);
    }
    return result;
  }

  function reset() {
    arcIndex = 0;
    arcCount = 0;
    for (const entry of arcHistory) {
        entry.density = 0;
        entry.register = 0;
        entry.dynamic = 0;
        entry.entropy = 0;
        entry.timeMs = 0;
    }
    smoothedDensity = 0.5;
    smoothedRegister = 0.5;
    smoothedDynamic = 0.5;
    smoothedEntropy = 0.5;
  }

  return { tick, getCorrections, getSilhouette, getSilhouetteArc, reset };
})();
crossLayerRegistry.register('crossLayerSilhouette', crossLayerSilhouette, ['all', 'section']);
