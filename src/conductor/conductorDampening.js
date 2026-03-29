// conductorDampening.js - Progressive deviation dampening engine for conductor pipelines.
// Extracted from conductorIntelligence.js. Prevents coordinated crush (many modules
// each pulling to 0.85-0.94) from accumulating catastrophic suppression.

conductorDampening = (() => {
  const V = validator.create('conductorDampening');
  // Base damping (0.6) calibrated for ~20 contributors.
  // Smaller pipelines get proportionally less pass-through so each module's
  // deviation is attenuated more, reducing volatility.
  const BASE_DEVIATION_DAMPING = 0.6;
  const REF_PIPELINE_SIZE = 20;

  // Track how many contributors produced non-1.0 values last beat per pipeline.
  // When dormant contributors inflate registryLength, dampening is miscalibrated.
  /** @type {Map<string, number>} */
  const conductorDampeningActiveCountByPipeline = new Map();

  // -- #3: Pipeline Product Centroid Controller (Hypermeta) --
  // Tracks rolling product EMA per pipeline and applies slow centroid-
  // correcting multiplier when products chronically drift from 1.0.
  // Addresses the density product 0.666 problem without manual tuning.
  const _CENTROID_EMA = 0.05;               // ~20-beat horizon
  const _CENTROID_MAX_CORRECTION = 0.25;    // max 25% correction (raised R7 Evo 3)
  /** @type {Map<string, number>} */
  const conductorDampeningCentroidEma = new Map();
  /** @type {Map<string, number>} */
  const conductorDampeningLastCentroidCorrection = new Map();

  // -- #4: Flicker Range Elasticity Controller (Hypermeta) --
  // Tracks 32-beat rolling flicker range and adjusts dampening base
  // dynamically. Compressed range -> reduce dampening; excessive range
  // -> increase dampening. Self-heals flicker range compression.
  const _FLICKER_RANGE_WINDOW = 32;
  let conductorDampeningTargetFlickerRange = 0.28; // R6 E2: 0.22->0.28 widen flicker elasticity target. Compressed threshold moves 0.132->0.168, triggering active range expansion earlier
  /** @type {number[]} */
  const conductorDampeningFlickerRingBuffer = [];
  let conductorDampeningFlickerDampeningBaseAdj = 0;

  // Progressive strength: as the running product diverges from 1.0,
  // subsequent deviations in the same direction face stronger dampening.
  // Deviations opposing the running product get lighter dampening to
  // encourage self-correction.
  const PROGRESSIVE_STRENGTH = 0.50;

  // -- Adaptive clamp widening (self-healing) --
  // Tracks per-contributor pinning via EMA. When a contributor is persistently
  // pinned (EMA > threshold), the effective clamp is widened by up to
  // MAX_WIDEN_FACTOR of the original range. This makes future modules
  // self-healing - they never need manual range re-tuning.
  const PINNED_EMA_ALPHA = 0.08;       // slow EMA to detect sustained pinning
  const PINNED_WIDEN_THRESHOLD = 0.60;  // >60% pinned triggers widening
  const MAX_WIDEN_FACTOR = 0.15;        // max 15% range extension
  /** @type {Map<string, { pinnedEma: number, widenLo: number, widenHi: number }>} */
  const conductorDampeningAdaptiveState = new Map();

  /**
   * Effective damping scaled by pipeline contributor count and system dynamics.
   * @param {number} registryLength
   * @param {string} [pipelineName] - optional pipeline name for per-pipeline tuning
   * @returns {number}
   */
  function scaledDamping(registryLength, pipelineName) {
    // Flicker pipeline gets lighter dampening (0.78) plus #4 elasticity adjustment
    // R34 E1: 0.85->0.78 to reduce 57% crush factor under explosive profile
    // Apply watchdog attenuation to elasticity adjustment so conflicting
    // flicker controllers self-dampen instead of canceling each other out.
    const elasticityAdj = pipelineName === 'flicker'
      ? conductorDampeningFlickerDampeningBaseAdj * conductorMetaWatchdog.getAttenuation('flicker', 'elasticity')
      : 0;
    let base = pipelineName === 'flicker' ? 0.78 + elasticityAdj : BASE_DEVIATION_DAMPING;
    try {
      const snap = systemDynamicsProfiler.getSnapshot();
      if (snap.regime === 'fragmented' || snap.regime === 'oscillating') {
        base *= 0.8; // Thicken gravity (less pass-through) when fragmented
      } else if (snap.regime === 'coherent') {
        base *= 1.18;
      } else if (snap.regime === 'exploring') {
        base *= 1.14;
      }
    } catch {
      // profiler snapshot may not be available during early boot or testing;
      // absence is non-fatal, so just ignore and proceed with default base.
    }
    // Use effective active count instead of raw registry length when available.
    // This prevents dormant contributors from inflating the dampening calibration.
    const activeCount = pipelineName ? (conductorDampeningActiveCountByPipeline.get(pipelineName) || registryLength) : registryLength;
    const effectiveLength = m.max(activeCount, registryLength * 0.5);
    return clamp(base * clamp(effectiveLength / REF_PIPELINE_SIZE, 0.3, 1.0), 0.1, 1.0);
  }

  /**
   * Progressive dampening factor for a single contributor.
   * @param {number} clamped - contributor's clamped bias value
   * @param {number} baseDamping - pipeline-scaled base dampening
   * @param {number} runningProduct - product so far (before this contributor)
   * @param {string} [pipelineName] - optional pipeline name for per-pipeline tuning
   * @returns {number} dampened value
   */
  function progressiveDampen(clamped, baseDamping, runningProduct, pipelineName) {
    const deviation = clamped - 1.0;
    if (m.abs(deviation) < 1e-6) return 1.0;

    // #8: Progressive strength auto-scaling - derive from active contributor
    // count instead of hardcoded pipeline-specific multipliers. More active
    // contributors need weaker per-contributor progressive dampening (they
    // self-cancel via the product dynamics). Replaces the hardcoded 0.5x
    // flicker special case with a general data-driven formula.
    const pipelineActiveCount = pipelineName ? (conductorDampeningActiveCountByPipeline.get(pipelineName) || REF_PIPELINE_SIZE) : REF_PIPELINE_SIZE;
    let progStrength = PROGRESSIVE_STRENGTH * clamp(pipelineActiveCount / REF_PIPELINE_SIZE, 0.3, 1.5);
    try {
      const snap = systemDynamicsProfiler.getSnapshot();
      if (snap.effectiveDimensionality < 2.0) {
        progStrength *= 1.5; // Stronger resistance to crush if dimensionality is collapsing
      }
      // R64 E3: Regime-responsive flicker dampening - evolving regime needs
      // wider flicker range for rhythmic texture variety. Reduce progressive
      // compounding so flicker deviations pass through more freely.
      if (pipelineName === 'flicker' && snap.regime === 'evolving') {
        progStrength *= 0.65;
      }
    } catch {
      // snapshot retrieval could fail early in boot; safe to ignore
    }

    const productDeviation = runningProduct - 1.0;
    const sameDirection = (deviation < 0 && productDeviation < 0) || (deviation > 0 && productDeviation > 0);
    const drift = m.abs(productDeviation);
    const extraDampening = sameDirection ? progStrength * clamp(drift, 0, 0.5) : 0;
    let effectiveDamping = clamp(baseDamping - extraDampening, 0.15, baseDamping);
    if (pipelineName === 'flicker' && deviation > 0) {
      let phaseCollapsePressure = 0;
      let edgePressure = 0;
      let densityEntropyPressure = 0;
      try {
        const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
        const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
          ? axisEnergy.shares.phase
          : 1.0 / 6.0;
        const lowPhaseThreshold = phaseFloorController.getLowShareThreshold();
        phaseCollapsePressure = clamp((lowPhaseThreshold - phaseShare) / m.max(lowPhaseThreshold, 0.01), 0, 1);
        const sectionProgress = timeStream.normalizedProgress('section');
        if (typeof sectionProgress === 'number' && Number.isFinite(sectionProgress)) {
          const edgeDistance = m.min(clamp(sectionProgress, 0, 1), clamp(1 - sectionProgress, 0, 1));
          edgePressure = clamp((0.18 - edgeDistance) / 0.18, 0, 1);
        }
        const snap = systemDynamicsProfiler.getSnapshot();
        if (snap && snap.couplingMatrix && typeof snap.couplingMatrix['density-entropy'] === 'number' && Number.isFinite(snap.couplingMatrix['density-entropy'])) {
          densityEntropyPressure = clamp((m.abs(snap.couplingMatrix['density-entropy']) - 0.50) / 0.20, 0, 1);
        }
      } catch {
        // Axis energy is not always available during early boot.
      }
      const hotspotPressure = clamp(m.max(0, productDeviation) + deviation + phaseCollapsePressure * 0.35 + edgePressure * 0.08 + densityEntropyPressure * 0.06, 0, 0.80);
      effectiveDamping = clamp(effectiveDamping - hotspotPressure * 0.20, 0.15, baseDamping);
    }
    return 1.0 + deviation * effectiveDamping;
  }

  /**
   * Apply progressive deviation dampening to a full pipeline registry.
   * @param {Array<{ name: string, getter: () => number, lo: number, hi: number }>} registry
   * @param {string} [pipelineName] - optional pipeline name for per-pipeline tuning
   * @returns {number} dampened product
   */
  function collectDampened(registry, pipelineName) {
    const damping = scaledDamping(registry.length, pipelineName);
    let product = 1;
    let activeCount = 0;
    for (let i = 0; i < registry.length; i++) {
      const raw = registry[i].getter();
      if (m.abs(raw - 1.0) > 1e-6) activeCount++;
      product *= progressiveDampen(clamp(raw, registry[i].lo, registry[i].hi), damping, product, pipelineName);
    }
    if (pipelineName) conductorDampeningActiveCountByPipeline.set(pipelineName, activeCount);
    // #3: Apply centroid correction
    product = conductorDampeningApplyCentroidCorrection(product, pipelineName);
    // #4: Track flicker range for elasticity controller
    if (pipelineName === 'flicker') conductorDampeningUpdateFlickerRange(product);
    // #10: Meta-observation telemetry
    conductorDampeningEmitMetaTelemetry(product, pipelineName);
    return product;
  }

  /**
   * Like collectDampened but with per-contributor attribution.
   * Includes adaptive clamp widening: persistently pinned contributors
   * get their effective clamp range gradually widened so the system
   * self-heals boundary pinning without manual re-tuning.
   * @param {Array<{ name: string, getter: () => number, lo: number, hi: number }>} registry
   * @param {string} [pipelineName] - optional pipeline name for per-pipeline tuning
   * @returns {{ product: number, contributions: Array<{ name: string, raw: number, clamped: number }> }}
   */
  function collectDampenedWithAttribution(registry, pipelineName) {
    const damping = scaledDamping(registry.length, pipelineName);
    let product = 1;
    let activeCount = 0;
    const contributions = [];
    for (let i = 0; i < registry.length; i++) {
      const entry = registry[i];
      const raw = entry.getter();

      // -- Adaptive clamp widening --
      let lo = entry.lo;
      let hi = entry.hi;
      let as = conductorDampeningAdaptiveState.get(entry.name);
      if (!as) {
        as = { pinnedEma: 0, widenLo: 0, widenHi: 0 };
        conductorDampeningAdaptiveState.set(entry.name, as);
      }
      const isPinned = (raw < lo || raw > hi) ? 1 : 0;
      as.pinnedEma = as.pinnedEma * (1 - PINNED_EMA_ALPHA) + isPinned * PINNED_EMA_ALPHA;
      if (as.pinnedEma > PINNED_WIDEN_THRESHOLD) {
        const range = hi - lo;
        const widenAmount = range * MAX_WIDEN_FACTOR * clamp((as.pinnedEma - PINNED_WIDEN_THRESHOLD) / (1 - PINNED_WIDEN_THRESHOLD), 0, 1);
        // Widen toward the side that's being pinned
        if (raw < lo) as.widenLo = clamp(as.widenLo + widenAmount * 0.1, 0, range * MAX_WIDEN_FACTOR);
        if (raw > hi) as.widenHi = clamp(as.widenHi + widenAmount * 0.1, 0, range * MAX_WIDEN_FACTOR);
        lo -= as.widenLo;
        hi += as.widenHi;
      } else {
        // Relax widening when pinning subsides
        as.widenLo *= 0.98;
        as.widenHi *= 0.98;
        lo -= as.widenLo;
        hi += as.widenHi;
      }

      const clamped = clamp(raw, lo, hi);
      if (m.abs(raw - 1.0) > 1e-6) activeCount++;
      product *= progressiveDampen(clamped, damping, product, pipelineName);
      contributions.push({ name: entry.name, raw, clamped });
    }
    if (pipelineName) conductorDampeningActiveCountByPipeline.set(pipelineName, activeCount);
    // #3: Apply centroid correction to attribution product
    const correctedProduct = conductorDampeningApplyCentroidCorrection(product, pipelineName);
    // #4: Track flicker range for elasticity controller
    if (pipelineName === 'flicker') conductorDampeningUpdateFlickerRange(correctedProduct);
    // #10: Meta-observation telemetry
    conductorDampeningEmitMetaTelemetry(correctedProduct, pipelineName);
    return { product: correctedProduct, contributions };
  }

  // -- #3: Centroid correction function (R7 Evo 3: density+tension only) --
  /**
   * Applies slow centroid-correcting multiplier when pipeline product
   * chronically drifts from 1.0. Skips flicker axis to avoid fighting
   * the flicker range elasticity controller (#4).
   * @param {number} product
   * @param {string} [pipelineName]
   * @returns {number}
   */
  function conductorDampeningApplyCentroidCorrection(product, pipelineName) {
    if (!pipelineName) return product;
    // Skip flicker axis entirely - centroid pull suppresses
    // needed flicker variance and fights elasticity controller (#4).
    // R64: Confirmed empirically - enabling centroid for flicker inflates
    // the flicker product, expanding flicker axis energy share and
    // catastrophically collapsing phase (0.1131 -> 0.0009).
    if (pipelineName === 'flicker') return product;
    const prev = V.optionalFinite(conductorDampeningCentroidEma.get(pipelineName), 1.0);
    const updated = prev * (1 - _CENTROID_EMA) + product * _CENTROID_EMA;
    conductorDampeningCentroidEma.set(pipelineName, updated);
    const drift = updated - 1.0;
    const correction = clamp(-drift, -_CENTROID_MAX_CORRECTION, _CENTROID_MAX_CORRECTION);
    // Apply watchdog attenuation: when centroid is flagged as conflicting
    // with another controller on this axis, reduce correction strength.
    const centroidAtten = conductorMetaWatchdog.getAttenuation(pipelineName, 'centroid');
    const attenuatedCorrection = correction * centroidAtten;
    conductorDampeningLastCentroidCorrection.set(pipelineName, attenuatedCorrection);
    return product * (1.0 + attenuatedCorrection);
  }

  // -- #4: Flicker range elasticity update --
  /**
   * Updates the flicker dampening base adjustment based on rolling range.
   * @param {number} flickerProduct
   */
  function conductorDampeningUpdateFlickerRange(flickerProduct) {
    conductorDampeningFlickerRingBuffer.push(flickerProduct);
    if (conductorDampeningFlickerRingBuffer.length > _FLICKER_RANGE_WINDOW) conductorDampeningFlickerRingBuffer.shift();
    if (conductorDampeningFlickerRingBuffer.length < 8) return;
    let fMin = Infinity;
    let fMax = -Infinity;
    for (let i = 0; i < conductorDampeningFlickerRingBuffer.length; i++) {
      if (conductorDampeningFlickerRingBuffer[i] < fMin) fMin = conductorDampeningFlickerRingBuffer[i];
      if (conductorDampeningFlickerRingBuffer[i] > fMax) fMax = conductorDampeningFlickerRingBuffer[i];
    }
    const range = fMax - fMin;
    if (range < conductorDampeningTargetFlickerRange * 0.6) {
      // Range compressed: reduce dampening to allow more expression
      // R64 E2: 0.015->0.025 rate, 0.15->0.22 cap for faster self-healing
      conductorDampeningFlickerDampeningBaseAdj = clamp(conductorDampeningFlickerDampeningBaseAdj + 0.025, 0, 0.22);
    } else if (range > conductorDampeningTargetFlickerRange * 2.5) {
      // Range too wide: increase dampening to rein it in
      // R34 E1: 2.0x->2.5x allows wider flicker expression before tightening
      conductorDampeningFlickerDampeningBaseAdj = clamp(conductorDampeningFlickerDampeningBaseAdj - 0.025, -0.22, 0);
    } else {
      // In target range: relax adjustment toward zero
      conductorDampeningFlickerDampeningBaseAdj *= 0.95;
    }
  }

  // -- #10: Meta-observation telemetry --
  /**
   * Emits per-beat meta-controller diagnostics to explainabilityBus.
   * @param {number} product
   * @param {string} [pipelineName]
   */
  function conductorDampeningEmitMetaTelemetry(product, pipelineName) {
    V.assertNonEmptyString(pipelineName, 'pipelineName');
    safePreBoot.call(() => {
      const centroidCorr = V.optionalFinite(conductorDampeningLastCentroidCorrection.get(pipelineName), 0);
      explainabilityBus.emit('meta-dampening-telemetry', 'both', {
        pipeline: pipelineName,
        product,
        centroidEma: V.optionalFinite(conductorDampeningCentroidEma.get(pipelineName), 1.0),
        centroidCorrection: centroidCorr,
        flickerDampeningBaseAdj: pipelineName === 'flicker' ? conductorDampeningFlickerDampeningBaseAdj : 0,
        activeCount: conductorDampeningActiveCountByPipeline.get(pipelineName) || 0
      });
      // Feed correction signs to meta-controller watchdog
      if (centroidCorr !== 0) {
        conductorMetaWatchdog.recordCorrection(pipelineName, 'centroid', centroidCorr);
      }
      if (pipelineName === 'flicker' && conductorDampeningFlickerDampeningBaseAdj !== 0) {
        conductorMetaWatchdog.recordCorrection('flicker', 'elasticity', conductorDampeningFlickerDampeningBaseAdj);
      }
    });
  }

  /**
   * Set profile-adaptive flicker target range.
   * Called by systemDynamicsProfiler during profile resolution.
   * Wider target lets the elasticity controller tolerate more flicker
   * expression before crushing, reducing the 50% crush warning.
   * @param {number} target
   */
  function setFlickerTargetRange(target) {
    conductorDampeningTargetFlickerRange = V.requireFinite(target, 'setFlickerTargetRange.target');
  }

  return { scaledDamping, progressiveDampen, collectDampened, collectDampenedWithAttribution, setFlickerTargetRange };
})();
