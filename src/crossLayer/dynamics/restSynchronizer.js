// src/crossLayer/restSynchronizer.js - Coordinated and complementary musical silence.
// Coordinates shared rests (both layers go quiet together for breathing room)
// and complementary rests (one layer fills when the other rests, creating hocket).
// Driven by interactionHeatMap pressure and sectionIntentCurves density.

restSynchronizer = (() => {
  const V = validator.create('restSynchronizer');
  const MIN_REST_INTERVAL_SEC = 0.8;
  // R73 E5: Regime-responsive base rest probability. Coherent regime
  // gets more shared rests (breathing room in unified sections),
  // exploring gets fewer (keeping energy up). Creates density variance
  // through structurally motivated rest placement.
  // R74 E5: Moderated base 0.18->0.14 and coherent bonus 0.08->0.05.
  // R73 showed 24% note count drop after rest sync introduction.
  // The combined coherent rest probability was 0.26 -- too aggressive
  // for a system that already has density regulation elsewhere.
  const SHARED_REST_BASE = 0.14;
  const SHARED_REST_COHERENT_BONUS = 0.05;
  const SHARED_REST_EXPLORING_PENALTY = 0.06;
  const COMPLEMENT_FILL_THRESHOLD = 0.45;

  /** @type {Record<string, number>} last rest timestamp per layer (seconds) */
  let lastRestSec = crossLayerHelpers.createLayerPair(-Infinity);
  /** @type {Record<string, boolean>} whether layer is currently resting */
  let isResting = crossLayerHelpers.createLayerPair(false);
  let sharedRestCount = 0;

  /**
   * Evaluate whether both layers should share a rest at this moment.
   * @param {number} absoluteSeconds
   * @param {string} layer
   * @param {{ heatLevel?: number, densityTarget?: number, phaseMode?: string }} signals
   * @returns {{ shouldRest: boolean, duration: number }}
   */
  function evaluateSharedRest(absoluteSeconds, layer, signals) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const sig = (signals && typeof signals === 'object') ? signals : {};

    // Throttle: don't rest too frequently
    if (absoluteSeconds - lastRestSec[layer] < MIN_REST_INTERVAL_SEC) {
      return { shouldRest: false, duration: 0 };
    }

    // Get heat level from interactionHeatMap
    const heatLevel = V.optionalFinite(sig.heatLevel, 0.5);

    // Get density target from sectionIntentCurves
    const densityTarget = V.optionalFinite(sig.densityTarget, 0.5);

    // Shared rests are more likely when heat is high (need breathing room)
    // and density target is low
    const restUrgency = clamp((heatLevel - 0.5) * 2 + (1 - densityTarget) * 0.5, 0, 1);

    // R73 E5: Regime-responsive rest probability
    const snap = systemDynamicsProfiler.getSnapshot();
    const regime = snap ? snap.regime : 'exploring';
    const regimeBonus = regime === 'coherent' ? SHARED_REST_COHERENT_BONUS
      : regime === 'exploring' ? -SHARED_REST_EXPLORING_PENALTY
      : 0;
    // R93 E3: Conductor density interaction. Real-time conductor density
    // (0.3-0.7 range) drives rest probability: higher density increases
    // rest likelihood, creating natural breathing room in dense passages.
    // This is a negative-feedback path: density -> rests -> effective density
    // reduction. Contributes to density-trust decorrelation since rest
    // events affect trust payoffs independently of flicker behavior.
    const conductorSigs = conductorSignalBridge.getSignals();
    const conductorDensity = V.optionalFinite(conductorSigs.density, 1.0);
    // densityProduct is a multiplicative modifier centered around 1.0 (range ~0.5-1.8).
    // Above 1.0 = denser, below 1.0 = sparser. Scale modestly.
    const densityRestBoost = clamp((conductorDensity - 1.0) * 0.08, -0.04, 0.04);
    // E11: Boost rest probability during structural sparse windows
    const e11RestBoost = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e11RestBoost'), 1.0));
    // E23: Rest pressure boost under exceedance. When system is stressed,
    // gently increase rest probability to decompress density naturally.
    // Multiplier on base probability only (not on urgency or phase bonus)
    // to avoid compounding with other pressure signals.
    const e23RestBoost = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('e23RestPressureBoost'), 1.0));
    // Coherence-aware rest boost: poor coherence (bias far from 1.0) increases rest value
    const coherenceEntry = L0.getLast('coherence', { layer: 'both' });
    const coherenceDeviation = coherenceEntry ? m.abs(V.optionalFinite(coherenceEntry.bias, 1.0) - 1.0) : 0;
    const coherenceRestBoost = clamp(coherenceDeviation * 0.15, 0, 0.06);
    // Harmonic change breathing: rest more likely after recent key change
    const harmonicEntry = L0.getLast('harmonic', { layer: 'both', since: absoluteSeconds - 3, windowSeconds: 3 });
    const harmonicRestBoost = harmonicEntry && harmonicEntry.excursion > 2 ? 0.05 : 0;
    const restProb = (SHARED_REST_BASE * e23RestBoost + regimeBonus + densityRestBoost + coherenceRestBoost + harmonicRestBoost) * (1 + restUrgency) * e11RestBoost;

    // Phase mode affects rest probability: locked layers rest together more naturally
    const phaseMode = (typeof sig.phaseMode === 'string') ? sig.phaseMode : 'free';
    const phaseBonus = phaseMode === 'lock' ? 0.1 : 0;

    if (rf() > restProb + phaseBonus) {
      return { shouldRest: false, duration: 0 };
    }

    // Calculate rest duration based on tpBeat
    const beatMs = spBeat > 0 ? spBeat * 1000 : 500;
    const duration = beatMs * rf(0.25, 1.5);

    lastRestSec[layer] = absoluteSeconds;
    isResting[layer] = true;
    sharedRestCount++;

    return { shouldRest: true, duration };
  }

  /**
   * Evaluate whether this layer should fill a gap left by the other layer resting.
   * Creates hocket-like interleaving.
   * @param {number} absoluteSeconds
   * @param {string} activeLayer
   * @returns {{ shouldFill: boolean, fillUrgency: number }}
   */
  function evaluateComplementaryRest(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    const otherLayer = crossLayerHelpers.getOtherLayer(activeLayer);

    // If other layer is resting, this layer should fill
    if (isResting[otherLayer]) {
      const urgency = clamp(rf(0.3, 0.9), 0, 1);
      return { shouldFill: urgency > COMPLEMENT_FILL_THRESHOLD, fillUrgency: urgency };
    }

    // Check if other layer is sparse from ATW
    const otherCount = L0.count('note', {
      layer: otherLayer,
      since: absoluteSeconds - 0.5,
      windowSeconds: 0.5
    });
    if (otherCount === 0) {
      return { shouldFill: true, fillUrgency: 0.7 };
    }

    return { shouldFill: false, fillUrgency: 0 };
  }

  /**
   * Signal that a rest period has ended for a layer.
   * @param {number} absoluteSeconds
   * @param {string} layer
   */
  function postRest(absoluteSeconds, layer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    isResting[layer] = false;
  }

  /** @returns {number} */
  function getSharedRestCount() { return sharedRestCount; }

  /** @returns {boolean} */
  function isLayerResting(layer) { return Boolean(isResting[layer]); }

  function reset() {
    lastRestSec = crossLayerHelpers.createLayerPair(-Infinity);
    isResting = crossLayerHelpers.createLayerPair(false);
    sharedRestCount = 0;
  }

  return { evaluateSharedRest, evaluateComplementaryRest, postRest, getSharedRestCount, isLayerResting, reset };
})();
crossLayerRegistry.register('restSynchronizer', restSynchronizer, ['all', 'section']);
