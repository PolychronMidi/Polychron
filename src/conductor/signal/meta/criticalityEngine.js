

/**
 * Self-Organized Criticality Engine
 *
 * The crown-jewel evolution. Monitors the system's distance from the
 * "edge of chaos" - the boundary between ordered (low-entropy, high-
 * coupling) and disordered (high-entropy, low-coupling) regimes.
 *
 * Mechanism:
 *   1. Each beat, samples density/tension/flicker deviation from neutral.
 *   2. Computes an "energy" metric (sum of squared deviations).
 *   3. Tracks energy accumulation over a sliding window.
 *   4. When energy exceeds a threshold - "avalanche" (sharp correction).
 *   5. Avalanche statistics follow power-law-like distribution (self-similar).
 *   6. Tunable: the threshold adapts to maintain ~20 % avalanche rate.
 *
 * Registers density + tension + flicker biases. During an avalanche,
 * biases snap toward neutral. Between avalanches, allows accumulation.
 */

criticalityEngine = (() => {
  const V = validator.create('criticalityEngine');

  const WINDOW         = 16;       // beats to accumulate
  const TARGET_RATE    = 0.20;     // desired avalanche fraction
  const THRESHOLD_INIT = 0.40;     // initial energy threshold
  const THRESHOLD_MIN  = 0.08;     // 0.15->0.08. Avg window energy ~0.096 never reached 0.15; engine fully dormant. At 0.08, avalanches fire during sustained normal energy.
  const THRESHOLD_MAX  = 1.20;
  const ADAPT_RATE     = 0.02;     // threshold adaptation speed
  // 0.92->0.96. Engine just activated in (was dormant at 1.0).
  // Gentler snap (4% vs 8%) moderates the newly-active engine while
  // tension arc recovers from Q3 0.765->0.643 regression.
  const SNAP_STRENGTH  = 0.96;     // how hard avalanche snaps to neutral
  const RECOVERY_BEATS = 3;        // beats of neutral bias after avalanche

  let energyBuffer   = [];
  let threshold      = THRESHOLD_INIT;
  let avalancheCount = 0;
  let totalBeats     = 0;
  let inAvalanche    = 0;          // countdown beats remaining
  let currentBias    = 1.0;

  // Avalanche size log (for power-law diagnostics)
  /** @type {number[]} */
  let avalancheSizes = [];

  let densitySnap = 1.0;
  let tensionSnap = 1.0;
  let flickerSnap = 1.0;

  function criticalityEngineEnergy() {
    // The original neutral points (density=0.5, tension=1.0, flicker=0.5)
    // assumed density/flicker products center at 0.5 and tension at 1.0. In
    // practice, density product is ~0.6, tension product is ~0.98, flicker ~1.0.
    // Tension offset (-0.387 avg) created a constant energy floor of ~0.15 per
    // beat, inflating threshold and making the engine insensitive to actual
    // deviations. Adjust neutral points to match actual signal ranges so the
    // engine responds to genuine departures from equilibrium.
    const d = signalReader.density() - 0.6;
    const t = signalReader.tension() - 0.95;
    const f = signalReader.flicker() - 1.0;
    return d * d + t * t + f * f;
  }

  function refresh(ctx) {
    if (ctx && ctx.layer === 'L2') return;
    totalBeats++;
    const e = criticalityEngineEnergy();
    energyBuffer.push(e);
    if (energyBuffer.length > WINDOW) energyBuffer.shift();

    const accumulated = energyBuffer.reduce((s, x) => s + x, 0);

    // Snapshot current signal levels for per-signal bias gating
    densitySnap = signalReader.density();
    tensionSnap = signalReader.tension();
    flickerSnap = signalReader.flicker();

    // Health-aware effective threshold: worse health -> lower trigger -> more corrective avalanches.
    // At healthEma=0.7 (nominal), scale=1.0 (unchanged). Stressed system (healthEma=0.35) -> scale=0.5 -> fires at half threshold.
    const critHealthEma = V.optionalFinite(safePreBoot.call(() => hyperMetaManager.getSnapshot().healthEma, 0.7), 0.7);
    const criticalityHealthScale = clamp(critHealthEma / 0.7, 0.5, 1.4);

    // Orchestrator-modulated snap: during emergence, reduce snap to let
    // novel patterns express; during locked state, amplify to break stasis.
    // E22 (snap softening under pressure) was refuted in R35 -- removing the
    // stabilizing snap made exceedance worse (49->122). Engine unchanged.
    const critSnapScale = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('criticalitySnap'), 1.0));
    const effectiveSnap = clamp(SNAP_STRENGTH + (1.0 - SNAP_STRENGTH) * (1.0 - critSnapScale), SNAP_STRENGTH, 1.0);

    if (inAvalanche > 0) {
      inAvalanche--;
      currentBias = effectiveSnap + (1.0 - effectiveSnap) * (1 - inAvalanche / RECOVERY_BEATS);
      // Still in recovery - skip accumulation check
    } else if (accumulated > threshold * criticalityHealthScale && energyBuffer.length >= WINDOW / 2) {
      // Avalanche
      avalancheCount++;
      avalancheSizes.push(accumulated);
      if (avalancheSizes.length > 200) avalancheSizes.shift();

      inAvalanche = RECOVERY_BEATS;
      currentBias = effectiveSnap;
      energyBuffer = [];

      explainabilityBus.emit('avalanche', '0', {
        energy: accumulated,
        threshold,
        count: avalancheCount,
      }, V.optionalFinite(conductorState.getField('tick'), 0));
    } else {
      currentBias = 1.0;
    }

    // Adaptive threshold
    const rate = totalBeats > 0 ? avalancheCount / totalBeats : 0;
    if (rate > TARGET_RATE) {
      threshold = m.min(THRESHOLD_MAX, threshold + ADAPT_RATE);
    } else if (rate < TARGET_RATE * 0.5) {
      threshold = m.max(THRESHOLD_MIN, threshold - ADAPT_RATE);
    }
  }

  // Per-signal bias: scale by pipeline health grade from signalHealthAnalyzer.
  // Healthy pipelines get full avalanche damping; strained pipelines get reduced;
  // stressed/critical pipelines (already struggling) get no further damping.
  // Original binary gates preserved as first pass.

  /** @param {string} grade @returns {number} */
  function criticalityEngineHealthScale(grade) {
    if (grade === 'healthy') return 1.0;
    if (grade === 'strained') return 0.5;
    return 0; // stressed or critical - skip damping entirely
  }

  function densityBias() {
    if (densitySnap < 0.52) return 1.0;
    const scale = criticalityEngineHealthScale(signalHealthAnalyzer.getHealth().density.grade);
    return 1.0 + (currentBias - 1.0) * scale;
  }
  function tensionBias() {
    // Section-position-aware bypass. In the back half of sections,
    // skip tension bias entirely so the engine doesn't compound suppression
    // in Q3/Q4 territory (Q3 collapsed 0.765->0.643). Front half keeps
    // normal gating. This is a structural change to the controller chain.
    {
      let secProgForGate = 0;
      try { secProgForGate = clamp(timeStream.compoundProgress('section'), 0, 1); } catch { /* timeStream boot-safety */ }
      if (secProgForGate > 0.55) return 1.0;
    }
    // Orchestrator tension floor protection. When the manager detects
    // S0 tension collapse risk, it emits a protection signal. Reduce
    // avalanche damping on tension to let tension recover naturally.
    const tensionProtection = /** @type {number} */ (safePreBoot.call(() => hyperMetaManager.getRateMultiplier('tensionFloorProtection'), 1.0));
    const tensionHealth = signalHealthAnalyzer.getHealth().tension.grade;
    const scale = criticalityEngineHealthScale(tensionHealth);
    // Centralized tension damping gate: bypass when EITHER orchestrator protection OR health crisis
    if (tensionProtection > 1.2 || scale === 0 || tensionSnap < 0.85) return 1.0;
    return 1.0 + (currentBias - 1.0) * scale;
  }
  function flickerMod() {
    if (flickerSnap < 0.70) return 1.0;
    const scale = criticalityEngineHealthScale(signalHealthAnalyzer.getHealth().flicker.grade);
    return 1.0 + (currentBias - 1.0) * scale;
  }

  function getState() {
    return {
      threshold,
      avalancheCount,
      totalBeats,
      rate: totalBeats > 0 ? Number((avalancheCount / totalBeats).toFixed(3)) : 0,
      inAvalanche: inAvalanche > 0,
      recentEnergy: energyBuffer.length > 0
        ? Number(energyBuffer[energyBuffer.length - 1].toFixed(4))
        : 0,
    };
  }

  function reset() {
    energyBuffer   = [];
    threshold      = THRESHOLD_INIT;
    avalancheCount = 0;
    totalBeats     = 0;
    inAvalanche    = 0;
    currentBias    = 1.0;
    avalancheSizes = [];
    densitySnap    = 1.0;
    tensionSnap    = 1.0;
    flickerSnap    = 1.0;
  }

  // Self-registration
  conductorIntelligence.registerDensityBias('criticalityEngine', densityBias, 0.88, 1.05);
  conductorIntelligence.registerTensionBias('criticalityEngine', tensionBias, 0.88, 1.05);
  conductorIntelligence.registerFlickerModifier('criticalityEngine', flickerMod, 0.82, 1.12);
  conductorIntelligence.registerRecorder('criticalityEngine', refresh);
  conductorIntelligence.registerStateProvider('criticalityEngine', getState);
  conductorIntelligence.registerModule('criticalityEngine', { reset }, ['all']);

  return { densityBias, tensionBias, flickerMod, getState, reset };
})();
