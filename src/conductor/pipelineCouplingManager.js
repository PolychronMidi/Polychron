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

  const TARGET_DT_COUPLING = 0.35;
  const TARGET_TF_COUPLING = 0.30; // tension-flicker: looser target (some correlation is natural)
  const TARGET_FE_COUPLING = 0.35; // flicker-entropy: moderate — some is musically meaningful
  const GAIN               = 0.06;
  const TF_GAIN            = 0.04; // lighter touch for flicker decoupling
  const FE_GAIN            = 0.03; // gentlest touch — entropy variety → textural variety is partly desirable

  let biasTension = 1.0;
  let biasFlicker = 1.0;

  function refresh() {
    const snap = SystemDynamicsProfiler.getSnapshot();
    if (!snap || !snap.couplingMatrix) {
      biasTension = 1.0;
      biasFlicker = 1.0;
    } else {
      // --- Density-tension coupling management ---
      const dtCoupling = typeof snap.couplingMatrix['density-tension'] === 'number'
        ? snap.couplingMatrix['density-tension']
        : snap.couplingStrength;

      if (!Number.isFinite(dtCoupling)) {
        biasTension = 1.0;
      } else {
        const error = TARGET_DT_COUPLING - dtCoupling;
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

      // --- Tension-flicker coupling management ---
      // When tension-flicker correlation is too high, nudge flicker toward
      // neutral to break the shared-input lock. Uses lighter gain since
      // some natural correlation is acceptable (both respond to intensity).
      const tfCoupling = typeof snap.couplingMatrix['tension-flicker'] === 'number'
        ? snap.couplingMatrix['tension-flicker']
        : 0;

      if (!Number.isFinite(tfCoupling) || m.abs(tfCoupling) < TARGET_TF_COUPLING) {
        biasFlicker = 1.0;
      } else {
        // Positive excess coupling: suppress flicker when tension is high
        const excess = m.abs(tfCoupling) - TARGET_TF_COUPLING;
        const tensionDir = signalReader.tension() > 0.5 ? -1 : 1;
        biasFlicker = 1.0 + tensionDir * TF_GAIN * excess;
      }

      // --- Flicker-entropy coupling management ---
      // When flicker and entropy co-evolve too strongly (r=0.44 in last run),
      // flicker loses independence. Gentle nudge to decorrelate. Some coupling
      // is musically meaningful (entropy variety → textural variety), so the
      // target is higher than tension-flicker and the gain is lighter.
      const feCoupling = typeof snap.couplingMatrix['flicker-entropy'] === 'number'
        ? snap.couplingMatrix['flicker-entropy']
        : 0;

      if (Number.isFinite(feCoupling) && m.abs(feCoupling) > TARGET_FE_COUPLING) {
        const feExcess = m.abs(feCoupling) - TARGET_FE_COUPLING;
        // Push flicker opposite to the coupling direction
        biasFlicker *= 1.0 - m.sign(feCoupling) * FE_GAIN * feExcess;
      }
    }
  }

  function tensionBias() {
    return biasTension;
  }

  function flickerBias() {
    return biasFlicker;
  }

  function reset() {
    biasTension = 1.0;
    biasFlicker = 1.0;
  }

  // --- Self-registration ---
  ConductorIntelligence.registerTensionBias('pipelineCouplingManager', tensionBias, 0.92, 1.08);
  ConductorIntelligence.registerFlickerModifier('pipelineCouplingManager', flickerBias, 0.92, 1.08);
  ConductorIntelligence.registerRecorder('pipelineCouplingManager', refresh);
  ConductorIntelligence.registerModule('pipelineCouplingManager', { reset }, ['section']);

  return { tensionBias, flickerBias, reset };
})();
