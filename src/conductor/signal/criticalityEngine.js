// @ts-check

/**
 * Self-Organized Criticality Engine (E13)
 *
 * The crown-jewel evolution. Monitors the system's distance from the
 * "edge of chaos" — the boundary between ordered (low-entropy, high-
 * coupling) and disordered (high-entropy, low-coupling) regimes.
 *
 * Mechanism:
 *   1. Each beat, samples density/tension/flicker deviation from neutral.
 *   2. Computes an "energy" metric (sum of squared deviations).
 *   3. Tracks energy accumulation over a sliding window.
 *   4. When energy exceeds a threshold → "avalanche" (sharp correction).
 *   5. Avalanche statistics follow power-law-like distribution (self-similar).
 *   6. Tunable: the threshold adapts to maintain ~20 % avalanche rate.
 *
 * Registers density + tension + flicker biases. During an avalanche,
 * biases snap toward neutral. Between avalanches, allows accumulation.
 */

criticalityEngine = (() => {

  const WINDOW         = 16;       // beats to accumulate
  const TARGET_RATE    = 0.20;     // desired avalanche fraction
  const THRESHOLD_INIT = 0.40;     // initial energy threshold
  const THRESHOLD_MIN  = 0.15;
  const THRESHOLD_MAX  = 1.20;
  const ADAPT_RATE     = 0.02;     // threshold adaptation speed
  const SNAP_STRENGTH  = 0.92;     // how hard avalanche snaps to neutral
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

  function _energy() {
    const d = signalReader.density() - 0.5;
    const t = signalReader.tension() - 1.0;
    const f = signalReader.flicker() - 0.5;
    return d * d + t * t + f * f;
  }

  function refresh() {
    totalBeats++;
    const e = _energy();
    energyBuffer.push(e);
    if (energyBuffer.length > WINDOW) energyBuffer.shift();

    const accumulated = energyBuffer.reduce((s, x) => s + x, 0);

    // Snapshot current signal levels for per-signal bias gating
    densitySnap = signalReader.density();
    tensionSnap = signalReader.tension();
    flickerSnap = signalReader.flicker();

    if (inAvalanche > 0) {
      inAvalanche--;
      currentBias = SNAP_STRENGTH + (1.0 - SNAP_STRENGTH) * (1 - inAvalanche / RECOVERY_BEATS);
      // Still in recovery — skip accumulation check
    } else if (accumulated > threshold && energyBuffer.length >= WINDOW / 2) {
      // --- Avalanche ---
      avalancheCount++;
      avalancheSizes.push(accumulated);
      if (avalancheSizes.length > 200) avalancheSizes.shift();

      inAvalanche = RECOVERY_BEATS;
      currentBias = SNAP_STRENGTH;
      energyBuffer = [];

      ExplainabilityBus.emit('avalanche', '0', {
        energy: accumulated,
        threshold,
        count: avalancheCount,
      }, ConductorState.getField('tick') || 0);
    } else {
      currentBias = 1.0;
    }

    // --- Adaptive threshold ---
    const rate = totalBeats > 0 ? avalancheCount / totalBeats : 0;
    if (rate > TARGET_RATE) {
      threshold = Math.min(THRESHOLD_MAX, threshold + ADAPT_RATE);
    } else if (rate < TARGET_RATE * 0.5) {
      threshold = Math.max(THRESHOLD_MIN, threshold - ADAPT_RATE);
    }
  }

  // Per-signal bias: only dampen signals that are elevated, not already suppressed.
  // Density: strained when < 0.65 → skip dampening. Tension: elevated when > 1.1.
  // Flicker: suppressed when < 0.7 → skip dampening.
  function densityBias()  { return densitySnap < 0.65 ? 1.0 : currentBias; }
  function tensionBias()  { return tensionSnap < 1.0  ? 1.0 : currentBias; }
  function flickerMod()   { return flickerSnap < 0.70 ? 1.0 : currentBias; }

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

  // --- Self-registration ---
  ConductorIntelligence.registerDensityBias('criticalityEngine', densityBias, 0.88, 1.05);
  ConductorIntelligence.registerTensionBias('criticalityEngine', tensionBias, 0.88, 1.05);
  ConductorIntelligence.registerFlickerModifier('criticalityEngine', flickerMod, 0.88, 1.05);
  ConductorIntelligence.registerRecorder('criticalityEngine', refresh);
  ConductorIntelligence.registerStateProvider('criticalityEngine', getState);
  ConductorIntelligence.registerModule('criticalityEngine', { reset }, ['all']);

  return { densityBias, tensionBias, flickerMod, getState, reset };
})();
