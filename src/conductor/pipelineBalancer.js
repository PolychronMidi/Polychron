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
  const STRAINED_FLOOR      = 0.65;   // aggregate product below this → coordinated suppression
  const AGGREGATE_LIFT       = 0.15;   // max lift per beat when aggregate is strained

  let counterBias = 1.0;

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

    // Aggregate strained detection: when density product is suppressed by
    // coordinated small pulls (no single dominator), apply gentle lift.
    // Weight below-1.0 contributors to size the deficit proportionally.
    const densityNow = signalReader.density();
    if (densityNow < STRAINED_FLOOR && counterBias <= 1.0) {
      // Count how many contributors are below 1.0 vs above
      let suppressorPull = 0;
      let boosterPull = 0;
      if (attr && Array.isArray(attr)) {
        for (const a of attr) {
          if (a.value < 0.99) suppressorPull += 1.0 - a.value;
          else if (a.value > 1.01) boosterPull += a.value - 1.0;
        }
      }
      // Imbalance: excess suppression that isn't offset by boosters
      const netSuppression = clamp(suppressorPull - boosterPull, 0, 2);
      const deficit = clamp((STRAINED_FLOOR - densityNow) / STRAINED_FLOOR, 0, 1);
      // Scale lift by both structural deficit and suppressor imbalance
      counterBias = 1.0 + AGGREGATE_LIFT * deficit * clamp(netSuppression / 0.5, 0.5, 2.0);
    }
  }

  function densityBias() {
    return counterBias;
  }

  function reset() {
    counterBias = 1.0;
  }

  // --- Self-registration ---
  ConductorIntelligence.registerDensityBias('pipelineBalancer', densityBias, 0.92, 1.15);
  ConductorIntelligence.registerRecorder('pipelineBalancer', refresh);
  ConductorIntelligence.registerModule('pipelineBalancer', { reset }, ['section']);

  return { densityBias, reset };
})();
