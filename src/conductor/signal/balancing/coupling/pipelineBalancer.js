
/**
 * Pipeline Balancer - Attribution-Driven Self-Regulation (E5)
 *
 * Reads per-beat density attribution from signalReader. When a single
 * contributor dominates (>45 % of deviation from neutral), injects a
 * mild counter-bias to prevent monopoly. Pure homeostatic mechanism.
 */

moduleLifecycle.declare({
  name: 'pipelineBalancer',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'signalReader'],
  provides: ['pipelineBalancer'],
  init: (deps) => {
  const signalReader = deps.signalReader;
  const conductorIntelligence = deps.conductorIntelligence;

  const DOMINANCE_THRESHOLD = 0.45;
  const COUNTER_STRENGTH    = 0.04;
  const AGGREGATE_LIFT       = 0.25;   // raised (was 0.20) - pipelineBalancer only 1.022 at density 0.785
  const AGG_SMOOTH           = 0.45;   // rolled back (was 0.50) - oscillation solved; lighter EMA preserves beat-to-beat variation

  let counterBias = 1.0;
  let smoothedAggBias = 1.0;

  function refresh() {
    const attr = signalReader.densityAttribution();
    if (!attr || !Array.isArray(attr) || attr.length === 0) {
      counterBias = 1.0;
    } else {
      const totalDev = attr.reduce((s, a) => s + m.abs(a.value - 1.0), 0);
      if (totalDev < 0.01) {
        counterBias = 1.0;
      } else {
        let maxDev = 0;
        let maxDir = 0;
        for (const a of attr) {
          const d = m.abs(a.value - 1.0);
          if (d > maxDev) { maxDev = d; maxDir = a.value - 1.0; }
        }

        const share = maxDev / totalDev;
        if (share > DOMINANCE_THRESHOLD) {
          counterBias = 1.0 - m.sign(maxDir) * COUNTER_STRENGTH * (share - DOMINANCE_THRESHOLD);
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

  // Tension homeostasis via closedLoopController
  // When tension product diverges from neutral (1.0) by more than the deadband,
  // nudge it back. Gain = TENSION_LIFT / 0.5 = 0.28 matches the original scaling.
  const pipelineBalancerTensionCtrl = closedLoopController.create({
    name: 'pipelineBalancer.tension',
    observe: () => signalReader.tension(),
    target: () => 1.0,
    gain: 0.28,
    smoothing: 0,
    deadband: 0.25,
    clampRange: [0.86, 1.14],
    sourceDomain: 'tension_product',
    targetDomain: 'tension'
  });

  function refreshTension() {
    pipelineBalancerTensionCtrl.refresh();
  }

  function tensionBias() {
    return pipelineBalancerTensionCtrl.getBias();
  }

  function reset() {
    counterBias = 1.0;
    pipelineBalancerTensionCtrl.reset();
  }

  // Self-registration
  conductorIntelligence.registerDensityBias('pipelineBalancer', densityBias, 0.92, 1.15);
  conductorIntelligence.registerTensionBias('pipelineBalancer', tensionBias, 0.86, 1.14);
  conductorIntelligence.registerRecorder('pipelineBalancer', () => { refresh(); refreshTension(); });
  conductorIntelligence.registerModule('pipelineBalancer', { reset }, ['section']);

  return { densityBias, tensionBias, reset };
  },
});
