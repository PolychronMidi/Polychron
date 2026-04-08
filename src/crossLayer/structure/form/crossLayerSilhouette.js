// src/crossLayer/crossLayerSilhouette.js - Holistic combined-output conductor.
// Observes the combined behavior of all cross-layer modules and produces
// correctional biases to keep the overall output balanced and musical.
// Consumes spectralComplementarity ATG 'spectral' channel (dead-end signal).
// Acts as the "meta-conductor" layer above individual cross-layer modules.

crossLayerSilhouette = (() => {
  const V = validator.create('crossLayerSilhouette');
  const SMOOTHING_REGIME = { exploring: 0.22, evolving: 0.15, coherent: 0.10 };
  const CORRECTION_GAIN_REGIME = { exploring: 0.75, evolving: 1.0, coherent: 1.0 };
  const ARC_HISTORY = 16;

  /** @type {{ density: number, register: number, dynamic: number, entropy: number, timeInSeconds: number }[]} */
  const arcHistory = new Array(ARC_HISTORY).fill(null).map(() => ({ density: 0, register: 0, dynamic: 0, entropy: 0, timeInSeconds: 0 }));
  let arcIndex = 0;
  let arcCount = 0;

  let smoothedDensity = 0.5;
  let smoothedRegister = 0.5;
  let smoothedDynamic = 0.5;
  let smoothedEntropy = 0.5;

  /**
   * Tick the silhouette analyzer each beat.
   * @param {number} absoluteSeconds
   * @param {string} [activeLayer='L1']
   */
  function tick(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const layerForSpectral = (typeof activeLayer === 'string' && activeLayer.length > 0) ? activeLayer : 'L1';

    // Gather all available signals

    // Density from entropyRegulator
    const entropyReg = entropyRegulator.getRegulation();

    // Register balance from spectralComplementarity (using active layer, not hardcoded)
    const spectralComplement = spectralComplementarity.analyzeComplement(layerForSpectral);

    // Heat from interactionHeatMap
    const heat = interactionHeatMap.getDensity();

    // Convergence intensity boosts dynamic reading
    const convergenceRecent = convergenceDetector.wasRecent(absoluteSeconds, 'L1', 500) || convergenceDetector.wasRecent(absoluteSeconds, 'L2', 500);

    // Compute raw metrics
    const rawDensity = clamp(heat, 0, 1);
    const rawRegister = clamp(spectralComplement.gapWeight, 0, 1);
    // Melodic coupling: contourShape amplifies or dampens the dynamic reading.
    // Rising contour -> higher dynamic presence (silhouette tracks the build).
    // Falling contour -> softer dynamic presence (silhouette tracks the descent).
    const melodicCtxCS = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
    const contourDynBoost = melodicCtxCS
      ? (melodicCtxCS.contourShape === 'rising' ? 0.12 : melodicCtxCS.contourShape === 'falling' ? -0.08 : 0)
      : 0;
    const rawDynamic = clamp((convergenceRecent ? 0.7 : 0.4) + contourDynBoost, 0, 1);
    const rawEntropy = V.optionalFinite(entropyReg.currentEntropy, 0.5);

    // Regime-responsive smoothing: faster tracking during exploring, more stable arcs during coherent
    const regime = conductorSignalBridge.getSignals().regime || 'evolving';
    const smoothing = SMOOTHING_REGIME[regime] !== undefined ? SMOOTHING_REGIME[regime] : 0.15;
    // R73: emergentRhythm densitySurprise coupling -- unexpected rhythmic bursts sharpen silhouette tracking.
    // Opposing response to entropyRegulator: same trigger, structure sharpens while entropy rises.
    const rhythmEntryCS = L0.getLast('emergentRhythm', { layer: 'both' });
    const densitySurpriseCS = rhythmEntryCS && Number.isFinite(rhythmEntryCS.densitySurprise) ? rhythmEntryCS.densitySurprise : 0;
    // R77 E9: complexityEma slow-form bridge -- sustained rhythmic complexity keeps form stable (inertia)
    // Counterpart: entropyRegulator raises target under same condition (fast-chaos / slow-form coupling)
    const complexityEmaCS = rhythmEntryCS && Number.isFinite(rhythmEntryCS.complexityEma) ? rhythmEntryCS.complexityEma : 0;
    const complexityInertiaCS = clamp((complexityEmaCS - 0.5) * 0.20, 0, 0.10);
    // R78: phase-lock coupling -- repel mode (layer opposition) demands sharper structural tracking;
    // lock mode (sync) stabilizes the holistic arc (layers moving together need less correction).
    const phaseModeCSil = safePreBoot.call(() => rhythmicPhaseLock.getMode(), 'drift');
    const phaseSmoothing = phaseModeCSil === 'repel' ? 0.88 : phaseModeCSil === 'lock' ? 1.10 : 1.0;
    // R82 E1: registerMigrationDir bridge -- ascending register migration tightens silhouette form
    // (structural tracking firms up as pitch center rises). Counterpart: phaseAwareCadenceWindow
    // COMPRESSES cadence window under same signal (resist resolution during ascent).
    const registerMigFormCS = melodicCtxCS
      ? (melodicCtxCS.registerMigrationDir === 'ascending' ? 0.08 : melodicCtxCS.registerMigrationDir === 'descending' ? -0.05 : 0)
      : 0;
    // R85 E1: intervalFreshness antagonism bridge -- novel intervals sharpen silhouette structural tracking.
    // Counterpart: entropyRegulator RAISES entropy target under same signal (form tightens while chaos expands).
    const intervalFreshnessCS = melodicCtxCS ? V.optionalFinite(melodicCtxCS.intervalFreshness, 0.5) : 0.5;
    const intervalFreshnessNarrowCS = clamp((intervalFreshnessCS - 0.45) * 0.18, -0.03, 0.09);
    // R47 E3: ascendRatio antagonism bridge with climaxEngine -- ascending melodic intervals
    // tighten structural tracking (form braces for landing as melody climbs).
    // Counterpart: climaxEngine ACCELERATES climax approach under same signal (chaos rides the climb).
    const ascendRatioCS = melodicCtxCS ? V.optionalFinite(melodicCtxCS.ascendRatio, 0.5) : 0.5;
    const ascendFormTightenCS = clamp((ascendRatioCS - 0.50) * 0.16, -0.04, 0.08);
    // R92 E1: tessituraLoad antagonism bridge with verticalIntervalMonitor -- crowded register
    // loosens silhouette form tracking (wider structural tolerance gives register pressure room to breathe).
    // Counterpart: verticalIntervalMonitor TIGHTENS collision penalty under same signal (harmonic discipline + form flexibility).
    const tessituraLoadCS = melodicCtxCS ? V.optionalFinite(melodicCtxCS.tessituraLoad, 0.5) : 0.5;
    const tessituraFormRelaxCS = clamp((tessituraLoadCS - 0.5) * 0.22, -0.05, 0.10);
    // R92 E2: thematicDensity virgin coupling -- high thematic recurrence density tightens form tracking.
    // Recognizable motivic patterns demand structural coherence; the silhouette firms up around recurring themes.
    const thematicDensityCS = melodicCtxCS ? V.optionalFinite(melodicCtxCS.thematicDensity, 0.5) : 0.5;
    const thematicFormTightenCS = clamp((thematicDensityCS - 0.5) * 0.14, -0.03, 0.07);
    const effectiveSmoothing = clamp(smoothing * (1 - densitySurpriseCS * 0.30) * (1 - complexityInertiaCS) * phaseSmoothing * (1 - registerMigFormCS) * (1 - intervalFreshnessNarrowCS) * (1 - ascendFormTightenCS) * (1 + tessituraFormRelaxCS) * (1 - thematicFormTightenCS), 0.05, 0.40);

    // Smooth
    smoothedDensity = smoothedDensity * (1 - effectiveSmoothing) + rawDensity * effectiveSmoothing;
    smoothedRegister = smoothedRegister * (1 - effectiveSmoothing) + rawRegister * effectiveSmoothing;
    smoothedDynamic = smoothedDynamic * (1 - effectiveSmoothing) + rawDynamic * effectiveSmoothing;
    smoothedEntropy = smoothedEntropy * (1 - effectiveSmoothing) + rawEntropy * effectiveSmoothing;

    // Record arc history
    const entry = arcHistory[arcIndex];
    entry.density = smoothedDensity;
    entry.register = smoothedRegister;
    entry.dynamic = smoothedDynamic;
    entry.entropy = smoothedEntropy;
    entry.timeInSeconds = absoluteSeconds;

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

    // Regime-responsive correction gain: weaker during exploring (allow drift), stronger during coherent (enforce balance)
    const regime = conductorSignalBridge.getSignals().regime || 'evolving';
    const gainScale = CORRECTION_GAIN_REGIME[regime] !== undefined ? CORRECTION_GAIN_REGIME[regime] : 1.0;

    // Regime-responsive register target: wider register spread during exploring supports phase axis
    const REGISTER_TARGET_REGIME = { exploring: 0.40, evolving: 0.50, coherent: 0.55 };
    const registerTarget = REGISTER_TARGET_REGIME[regime] !== undefined ? REGISTER_TARGET_REGIME[regime] : 0.5;

    // Regime-responsive dynamic target: higher dynamic contrast during exploring supports tension arc
    const DYNAMIC_TARGET_REGIME = { exploring: 0.70, evolving: 0.60, coherent: 0.55 };
    const dynamicTarget = DYNAMIC_TARGET_REGIME[regime] !== undefined ? DYNAMIC_TARGET_REGIME[regime] : 0.6;

    return {
      densityBias: clamp((targetDensity - smoothedDensity) * 0.5 * gainScale, -0.3, 0.3),
      registerBias: clamp((registerTarget - smoothedRegister) * 0.4 * gainScale, -0.3, 0.3),
      dynamicBias: clamp((dynamicTarget - smoothedDynamic) * 0.3 * gainScale, -0.2, 0.2),
      entropyBias: clamp((targetEntropy - smoothedEntropy) * 0.4 * gainScale, -0.3, 0.3)
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
   * @returns {{ density: number, register: number, dynamic: number, entropy: number, timeInSeconds: number }[]}
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
        entry.timeInSeconds = 0;
    }
    smoothedDensity = 0.5;
    smoothedRegister = 0.5;
    smoothedDynamic = 0.5;
    smoothedEntropy = 0.5;
  }

  return { tick, getCorrections, getSilhouette, getSilhouetteArc, reset };
})();
crossLayerRegistry.register('crossLayerSilhouette', crossLayerSilhouette, ['all', 'section']);
