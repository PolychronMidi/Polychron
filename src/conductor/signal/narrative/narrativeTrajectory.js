

/**
 * Narrative Trajectory Engine (E10)
 *
 * Maintains a 3D trajectory (tension, novelty, density) that describes
 * the musical narrative arc. Computes velocity and curvature of this
 * trajectory and exposes it as conductor state. Registers a tension
 * bias that gently steers away from monotonic trajectories.
 */

narrativeTrajectory = (() => {

  const HISTORY_LEN      = 16;
  const SMOOTHING        = 0.3;
  const STEER_GAIN       = 0.06;       // doubled from 0.03 for audible effect
  const MONOTONE_THRESHOLD = 0.002;    // lowered from 0.005 - matches EMA-smoothed velocity scale
  const CURVATURE_STEER  = 0.04;       // steer away from pendulum reversals

  /** @type {{ t: number, n: number, d: number }[]} */
  let trajectory = [];
  let smoothed   = { t: 0.5, n: 0.5, d: 0.5 };
  let velocity   = 0;
  let curvature  = 0;
  let steerBias  = 1.0;

  function narrativeTrajectoryNovelty() {
    // Derive novelty from flicker (maps to textural change rate)
    return signalReader.flicker();
  }

  function refresh() {
    const t = signalReader.tension();
    const d = signalReader.density();
    const n = narrativeTrajectoryNovelty();

    const prev = { ...smoothed };
    smoothed.t = smoothed.t * (1 - SMOOTHING) + t * SMOOTHING;
    smoothed.n = smoothed.n * (1 - SMOOTHING) + n * SMOOTHING;
    smoothed.d = smoothed.d * (1 - SMOOTHING) + d * SMOOTHING;

    trajectory.push({ ...smoothed });
    if (trajectory.length > HISTORY_LEN) trajectory.shift();

    // Velocity = magnitude of change
    const dt = smoothed.t - prev.t;
    const dn = smoothed.n - prev.n;
    const dd = smoothed.d - prev.d;
    velocity = m.sqrt(dt * dt + dn * dn + dd * dd);

    // Curvature approximation from last 3 points
    if (trajectory.length >= 3) {
      const a = trajectory[trajectory.length - 3];
      const b = trajectory[trajectory.length - 2];
      const c = trajectory[trajectory.length - 1];
      const ab = m.sqrt((b.t - a.t) ** 2 + (b.n - a.n) ** 2 + (b.d - a.d) ** 2);
      const bc = m.sqrt((c.t - b.t) ** 2 + (c.n - b.n) ** 2 + (c.d - b.d) ** 2);
      const ac = m.sqrt((c.t - a.t) ** 2 + (c.n - a.n) ** 2 + (c.d - a.d) ** 2);
      const s = (ab + bc + ac) / 2;
      const area = m.sqrt(m.max(0, s * (s - ab) * (s - bc) * (s - ac)));
      curvature = ab + bc > 0.0001 ? (4 * area) / (ab * bc * ac + 1e-9) : 0;
    }

    // Steer when trajectory is too flat (monotone) or oscillating (high curvature)
    if (velocity < MONOTONE_THRESHOLD && trajectory.length >= 4) {
      steerBias = 1.0 + STEER_GAIN;
    } else if (curvature > 0.5 && trajectory.length >= 4) {
      // High curvature = pendulum reversal - nudge tension to break cycle
      steerBias = 1.0 + CURVATURE_STEER * clamp(curvature, 0.5, 2.0);
    } else {
      steerBias = 1.0;
    }

    //  Tension tail sustain floor.
    // Prevent the tension arc from collapsing in the final quarter of a section.
    // When section progress exceeds 75%, ensure a minimum tension bias of 1.02.
    const secProgress = timeStream.normalizedProgress('section');
    if (typeof secProgress === 'number' && Number.isFinite(secProgress)) {
      const edgeDistance = m.min(clamp(secProgress, 0, 1), clamp(1 - secProgress, 0, 1));
      const edgePressure = clamp((0.18 - edgeDistance) / 0.18, 0, 1);
      const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
      const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
        ? axisEnergy.shares.phase
        : 1.0 / 6.0;
      const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
        ? axisEnergy.shares.trust
        : 1.0 / 6.0;
      const lowPhasePressure = clamp((0.12 - phaseShare) / 0.12, 0, 1);
      const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
      const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
      const couplingMatrix = snap && snap.couplingMatrix ? snap.couplingMatrix : null;
      const densityFlickerPressure = couplingMatrix && typeof couplingMatrix['density-flicker'] === 'number' && Number.isFinite(couplingMatrix['density-flicker'])
        ? clamp((m.abs(couplingMatrix['density-flicker']) - 0.80) / 0.16, 0, 1)
        : 0;
      const hotspotRelief = clamp(densityFlickerPressure * 0.45 + trustSharePressure * 0.25 + lowPhasePressure * 0.30, 0, 1);
      if (edgePressure > 0) {
        steerBias = 1.0 + (steerBias - 1.0) * (1 - hotspotRelief * (0.35 + edgePressure * 0.35));
      }
      if (secProgress > 0.75) {
        steerBias = m.max(steerBias, 1.0 + 0.02 * (1 - hotspotRelief));
      }
    }
  }

  function tensionBias() { return steerBias; }

  function getTrajectory() {
    return {
      point: { ...smoothed },
      velocity,
      curvature,
      length: trajectory.length,
    };
  }

  function reset() {
    trajectory = [];
    smoothed   = { t: 0.5, n: 0.5, d: 0.5 };
    velocity   = 0;
    curvature  = 0;
    steerBias  = 1.0;
  }

  // Self-registration
  conductorIntelligence.registerTensionBias('narrativeTrajectory', tensionBias, 0.94, 1.12);
  conductorIntelligence.registerRecorder('narrativeTrajectory', refresh);
  conductorIntelligence.registerStateProvider('narrativeTrajectory', () => ({
    narrativeVelocity: velocity,
    narrativeCurvature: curvature,
    narrativePoint: { ...smoothed },
  }));
  conductorIntelligence.registerModule('narrativeTrajectory', { reset }, ['all']);

  return { getTrajectory, tensionBias, reset };
})();
