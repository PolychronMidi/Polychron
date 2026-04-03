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
  /** @type {Record<string, number>} when the current rest ends (seconds) */
  let restEndSec = crossLayerHelpers.createLayerPair(0);
  /** @type {Record<string, boolean>} whether layer is currently resting */
  let isResting = crossLayerHelpers.createLayerPair(false);
  let sharedRestCount = 0;
  let coordinationScale = 0.5;
  function setCoordinationScale(scale) { coordinationScale = clamp(scale, 0, 1); }
  function getCoordinationScale() { return coordinationScale; }

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

    // If already in an active rest, sustain it until restEndSec
    if (isResting[layer] && absoluteSeconds < restEndSec[layer]) {
      return { shouldRest: true, duration: (restEndSec[layer] - absoluteSeconds) * 1000 };
    }
    // Rest just expired naturally
    if (isResting[layer]) {
      isResting[layer] = false;
    }

    // Throttle: don't rest too frequently
    if (absoluteSeconds - lastRestSec[layer] < MIN_REST_INTERVAL_SEC) {
      return { shouldRest: false, duration: 0 };
    }

    // Get heat level from interactionHeatMap
    const heatLevel = V.optionalFinite(sig.heatLevel, 0.5);

    // Get density target from sectionIntentCurves
    const densityTarget = V.optionalFinite(sig.densityTarget, 0.5);
    // R34: rest-sync L0 -- other layer's rest intention boosts shared rest probability
    const restSyncLayer = crossLayerHelpers.getOtherLayer(layer);
    const otherRestEntry = L0.getLast('rest-sync', {
      layer: restSyncLayer, since: absoluteSeconds - 0.5, windowSeconds: 0.5
    });
    const restSyncBoost = otherRestEntry ? 0.08 : 0;

    // Shared rests are more likely when heat is high (need breathing room)
    // and density target is low
    const restUrgency = clamp((heatLevel - 0.5) * 2 + (1 - densityTarget) * 0.5 + restSyncBoost, 0, 1);

    // R73 E5: Regime-responsive rest probability
    const regime = conductorSignalBridge.getSignals().regime || 'exploring';
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
    // R34: articulation L0 awareness -- suppress rests when other layer is legato
    const otherLayer = crossLayerHelpers.getOtherLayer(layer);
    const artEntry = L0.getLast('articulation', { layer: otherLayer });
    const otherSustain = artEntry ? V.optionalFinite(artEntry.avgSustain, 0.5) : 0.5;
    const legatoSuppression = otherSustain > 0.7 ? -0.03 : 0;
    // CIM coordination scale: high = more shared rests, low = independent rest timing
    const cimScale = 0.5 + coordinationScale;
    const restProb = (SHARED_REST_BASE * e23RestBoost + regimeBonus + densityRestBoost + coherenceRestBoost + harmonicRestBoost + legatoSuppression) * (1 + restUrgency) * e11RestBoost * cimScale;

    // Phase mode affects rest probability: locked layers rest together more naturally
    const phaseMode = (typeof sig.phaseMode === 'string') ? sig.phaseMode : 'free';
    const phaseBonus = phaseMode === 'lock' ? 0.1 : 0;

    if (rf() > restProb + phaseBonus) {
      return { shouldRest: false, duration: 0 };
    }

    // Rest duration: 1-3 beats worth of silence (in seconds)
    const beatSec = spBeat > 0 ? spBeat : 0.5;
    const durationSec = beatSec * rf(1.0, 3.0);

    lastRestSec[layer] = absoluteSeconds;
    restEndSec[layer] = absoluteSeconds + durationSec;
    isResting[layer] = true;
    sharedRestCount++;
    // R34: post rest intention so other layer can respond
    L0.post('rest-sync', layer, absoluteSeconds, { duration: durationSec, urgency: restUrgency });

    return { shouldRest: true, duration: durationSec * 1000 };
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

    // Lab R5: density-aware fill suppression. When conductor density is low
    // (sparse/minimal contexts), complementary fill undermines intentional
    // sparsity. Scale urgency by density so ultra-sparse textures stay sparse.
    const conductorSigs = conductorSignalBridge.getSignals();
    const density = V.optionalFinite(conductorSigs.density, 1.0);
    const densityGate = clamp(density, 0.15, 1.0);

    // If other layer is resting, this layer should fill
    if (isResting[otherLayer]) {
      const urgency = clamp(rf(0.3, 0.9) * densityGate, 0, 1);
      return { shouldFill: urgency > COMPLEMENT_FILL_THRESHOLD, fillUrgency: urgency };
    }

    // Check if other layer is sparse from ATW
    const otherCount = L0.count('note', {
      layer: otherLayer,
      since: absoluteSeconds - 0.5,
      windowSeconds: 0.5
    });
    if (otherCount === 0) {
      const urgency = clamp(0.7 * densityGate, 0, 1);
      return { shouldFill: urgency > COMPLEMENT_FILL_THRESHOLD, fillUrgency: urgency };
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
    // Only clear rest if duration has elapsed
    if (absoluteSeconds >= restEndSec[layer]) {
      isResting[layer] = false;
    }
  }

  /** @returns {number} */
  function getSharedRestCount() { return sharedRestCount; }

  /** @returns {boolean} */
  function isLayerResting(layer) { return Boolean(isResting[layer]); }

  function reset() {
    lastRestSec = crossLayerHelpers.createLayerPair(-Infinity);
    restEndSec = crossLayerHelpers.createLayerPair(0);
    isResting = crossLayerHelpers.createLayerPair(false);
    sharedRestCount = 0;
  }

  return { evaluateSharedRest, evaluateComplementaryRest, postRest, getSharedRestCount, isLayerResting, setCoordinationScale, getCoordinationScale, reset };
})();
crossLayerRegistry.register('restSynchronizer', restSynchronizer, ['all', 'section']);
