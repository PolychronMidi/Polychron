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
  }

  function densityBias() {
    return counterBias;
  }

  function reset() {
    counterBias = 1.0;
  }

  // --- Self-registration ---
  ConductorIntelligence.registerDensityBias('pipelineBalancer', densityBias, 0.92, 1.08);
  ConductorIntelligence.registerRecorder('pipelineBalancer', refresh);
  ConductorIntelligence.registerModule('pipelineBalancer', { reset }, ['section']);

  return { densityBias, reset };
})();
