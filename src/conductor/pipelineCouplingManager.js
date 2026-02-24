// @ts-check

/**
 * Pipeline Coupling Manager (E6)
 *
 * Uses the coupling matrix from SystemDynamicsProfiler to decide
 * whether density and tension should move together or independently.
 * When coupling is already high, backs off; when low, nudges tension
 * toward density direction. Registered as a tension bias.
 */

pipelineCouplingManager = (() => {

  const TARGET_COUPLING = 0.35;
  const GAIN            = 0.06;

  let biasTension = 1.0;

  function refresh() {
    const snap = SystemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      biasTension = 1.0;
    } else {
      const dtKey = 'density-tension';
      const coupling = typeof snap.couplingMatrix[dtKey] === 'number'
        ? snap.couplingMatrix[dtKey]
        : snap.couplingStrength;

      if (!Number.isFinite(coupling)) {
        biasTension = 1.0;
      } else {
        const error = TARGET_COUPLING - coupling;
        const densityNow = signalReader.density();
        const tensionNow = signalReader.tension();
        const dirMatch   = (densityNow - 0.5) * (tensionNow - 0.5);

        if (error > 0 && dirMatch > 0) {
          biasTension = 1.0 + GAIN * error;
        } else if (error < 0) {
          biasTension = 1.0 + GAIN * error * 0.5;
        } else {
          biasTension = 1.0;
        }
      }
    }
  }

  function tensionBias() {
    return biasTension;
  }

  function reset() {
    biasTension = 1.0;
  }

  // --- Self-registration ---
  ConductorIntelligence.registerTensionBias('pipelineCouplingManager', tensionBias, 0.92, 1.08);
  ConductorIntelligence.registerRecorder('pipelineCouplingManager', refresh);
  ConductorIntelligence.registerModule('pipelineCouplingManager', { reset }, ['section']);

  return { tensionBias, reset };
})();
