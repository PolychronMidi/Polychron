// @ts-check

/**
 * Pipeline Coupling Manager (E6)
 *
 * Uses the coupling matrix from systemDynamicsProfiler to decide
 * whether density and tension should move together or independently.
 * When coupling is already high, backs off; when low, nudges tension
 * toward density direction. Registered as a tension bias.
 */

pipelineCouplingManager = (() => {

  const TARGET_DT_COUPLING = 0.20; // lowered (was 0.35) — d-t naturally decorrelated at 0.058; prevent overcorrection
  const TARGET_TF_COUPLING = 0.30; // tension-flicker: looser target (some correlation is natural)
  const TARGET_FE_COUPLING = 0.25; // flicker-entropy: tighter target (was 0.35, r=0.704 showed shared-input lock)
  const GAIN               = 0.24; // raised (was 0.20) — couplingStrength 0.162 < fragmented threshold; strengthen nudges
  const TF_GAIN            = 0.21; // raised (was 0.17) — t-f 0.109 well below 0.30 target; needs stronger nudge
  const FE_GAIN            = 0.12; // lowered (was 0.20) — f-e 0.495 overcoupled at 10× entropy; reduce to prevent lockstep

  const FATIGUE_RATE       = 0.05;
  const RECOVERY_RATE      = 0.10;
  const MAX_FATIGUE_DAMP   = 0.80;

  let biasTension = 1.0;
  let biasFlicker = 1.0;
  let fatigueTension = 0;
  let fatigueFlicker = 0;

  function refresh() {
    const snap = systemDynamicsProfiler.getSnapshot();
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

    // --- Fatigue mechanism ---
    // Sustained high bias accumulates fatigue; fatigue dampens the bias toward 1.0.
    const tensionDeviation = m.abs(biasTension - 1.0);
    if (tensionDeviation > 0.04) {
      fatigueTension = clamp(fatigueTension + FATIGUE_RATE * tensionDeviation, 0, 1);
    } else {
      fatigueTension = clamp(fatigueTension - RECOVERY_RATE, 0, 1);
    }
    if (fatigueTension > 0) {
      const damp = 1.0 - fatigueTension * MAX_FATIGUE_DAMP;
      biasTension = 1.0 + (biasTension - 1.0) * damp;
    }

    const flickerDeviation = m.abs(biasFlicker - 1.0);
    if (flickerDeviation > 0.04) {
      fatigueFlicker = clamp(fatigueFlicker + FATIGUE_RATE * flickerDeviation, 0, 1);
    } else {
      fatigueFlicker = clamp(fatigueFlicker - RECOVERY_RATE, 0, 1);
    }
    if (fatigueFlicker > 0) {
      const damp = 1.0 - fatigueFlicker * MAX_FATIGUE_DAMP;
      biasFlicker = 1.0 + (biasFlicker - 1.0) * damp;
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
    fatigueTension = 0;
    fatigueFlicker = 0;
  }

  // --- Self-registration ---
  conductorIntelligence.registerTensionBias('pipelineCouplingManager', tensionBias, 0.84, 1.20);
  conductorIntelligence.registerFlickerModifier('pipelineCouplingManager', flickerBias, 0.88, 1.12);
  conductorIntelligence.registerRecorder('pipelineCouplingManager', refresh);
  conductorIntelligence.registerModule('pipelineCouplingManager', { reset }, ['section']);

  feedbackRegistry.registerLoop(
    'pipelineCouplingManager',
    'coupling_matrix',
    'tension',
    () => m.abs(biasTension - 1.0) / 0.20,
    () => m.sign(biasTension - 1.0)
  );

  return { tensionBias, flickerBias, reset };
})();
