// @ts-check

/**
 * Pipeline Balancer — Attribution-Driven Self-Regulation (E5)
 *
 * Reads per-beat density attribution from signalReader. When a single
 * contributor dominates (>45 % of deviation from neutral), injects a
 * mild counter-bias to prevent monopoly. Pure homeostatic mechanism.
 */

pipelineBalancer = (() => {

  const DOMINANCE_THRESHOLD = 0.45;
  const COUNTER_STRENGTH    = 0.04;
  const AGGREGATE_LIFT       = 0.25;   // raised (was 0.20) — pipelineBalancer only 1.022 at density 0.785
  const AGG_SMOOTH           = 0.45;   // rolled back (was 0.50) — oscillation solved; lighter EMA preserves beat-to-beat variation

  let counterBias = 1.0;
  let smoothedAggBias = 1.0;

  function refresh() {
    const attr = signalReader.densityAttribution();
    if (!attr || !Array.isArray(attr) || attr.length === 0) {
      counterBias = 1.0;
    } else {
      const totalDev = attr.reduce((s, a) => s + Math.abs(a.value - 1.0), 0);
      if (totalDev < 0.01) {
        counterBias = 1.0;
      } else {
        let maxDev = 0;
        let maxDir = 0;
        for (const a of attr) {
          const d = Math.abs(a.value - 1.0);
          if (d > maxDev) { maxDev = d; maxDir = a.value - 1.0; }
        }

        const share = maxDev / totalDev;
        if (share > DOMINANCE_THRESHOLD) {
          counterBias = 1.0 - Math.sign(maxDir) * COUNTER_STRENGTH * (share - DOMINANCE_THRESHOLD);
        } else {
          counterBias = 1.0;
        }
      }
    }

    // Continuous aggregate lift: density below 1.0 activates proportional correction.
    // EMA-smoothed to prevent beat-to-beat jitter from feeding oscillation.
    const densityNow = signalReader.density();
    if (counterBias <= 1.0) {
      let suppressorPull = 0;
      let boosterPull = 0;
      if (attr && Array.isArray(attr)) {
        for (const a of attr) {
          if (a.value < 0.99) suppressorPull += 1.0 - a.value;
          else if (a.value > 1.01) boosterPull += a.value - 1.0;
        }
      }
      const netSuppression = clamp(suppressorPull - boosterPull, 0, 2);
      const deficit = clamp(1.0 - densityNow, 0, 1);
      const rawAgg = 1.0 + AGGREGATE_LIFT * deficit * clamp(netSuppression / 0.5, 0.5, 2.0);
      smoothedAggBias += AGG_SMOOTH * (rawAgg - smoothedAggBias);
      counterBias = smoothedAggBias;
    }
  }

  function densityBias() {
    return counterBias;
  }

  // --- Tension aggregate lift ---
  // Mirror of density-side logic: when tension product diverges significantly
  // from 1.0 due to coordinated small boosts (53% crush), nudge it back.
  const TENSION_NEUTRAL      = 1.0;
  const TENSION_STRAINED_GAP = 0.15; // activate when |product - 1.0| > this (was 0.20)
  const TENSION_LIFT         = 0.14; // max counter-bias magnitude per beat (was 0.08)

  let tensionCounter = 1.0;

  function refreshTension() {
    const tensionNow = signalReader.tension();
    const gap = tensionNow - TENSION_NEUTRAL;
    if (m.abs(gap) > TENSION_STRAINED_GAP) {
      // Counter the direction of excess: high tension → suppress, low → boost
      const deficit = clamp((m.abs(gap) - TENSION_STRAINED_GAP) / 0.5, 0, 1);
      tensionCounter = 1.0 - m.sign(gap) * TENSION_LIFT * deficit;
    } else {
      tensionCounter = 1.0;
    }
  }

  function tensionBias() {
    return tensionCounter;
  }

  function reset() {
    counterBias = 1.0;
    tensionCounter = 1.0;
  }

  // --- Self-registration ---
  conductorIntelligence.registerDensityBias('pipelineBalancer', densityBias, 0.92, 1.15);
  conductorIntelligence.registerTensionBias('pipelineBalancer', tensionBias, 0.86, 1.14);
  conductorIntelligence.registerRecorder('pipelineBalancer', () => { refresh(); refreshTension(); });
  conductorIntelligence.registerModule('pipelineBalancer', { reset }, ['section']);

  return { densityBias, tensionBias, reset };
})();
