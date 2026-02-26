// @ts-check

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
  const MONOTONE_THRESHOLD = 0.002;    // lowered from 0.005 — matches EMA-smoothed velocity scale
  const CURVATURE_STEER  = 0.04;       // steer away from pendulum reversals

  /** @type {{ t: number, n: number, d: number }[]} */
  let trajectory = [];
  let smoothed   = { t: 0.5, n: 0.5, d: 0.5 };
  let velocity   = 0;
  let curvature  = 0;
  let steerBias  = 1.0;

  function _novelty() {
    // Derive novelty from flicker (maps to textural change rate)
    return signalReader.flicker();
  }

  function refresh() {
    const t = signalReader.tension();
    const d = signalReader.density();
    const n = _novelty();

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
    velocity = Math.sqrt(dt * dt + dn * dn + dd * dd);

    // Curvature approximation from last 3 points
    if (trajectory.length >= 3) {
      const a = trajectory[trajectory.length - 3];
      const b = trajectory[trajectory.length - 2];
      const c = trajectory[trajectory.length - 1];
      const ab = Math.sqrt((b.t - a.t) ** 2 + (b.n - a.n) ** 2 + (b.d - a.d) ** 2);
      const bc = Math.sqrt((c.t - b.t) ** 2 + (c.n - b.n) ** 2 + (c.d - b.d) ** 2);
      const ac = Math.sqrt((c.t - a.t) ** 2 + (c.n - a.n) ** 2 + (c.d - a.d) ** 2);
      const s = (ab + bc + ac) / 2;
      const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ac)));
      curvature = ab + bc > 0.0001 ? (4 * area) / (ab * bc * ac + 1e-9) : 0;
    }

    // Steer when trajectory is too flat (monotone) or oscillating (high curvature)
    if (velocity < MONOTONE_THRESHOLD && trajectory.length >= 4) {
      steerBias = 1.0 + STEER_GAIN;
    } else if (curvature > 0.5 && trajectory.length >= 4) {
      // High curvature = pendulum reversal — nudge tension to break cycle
      steerBias = 1.0 + CURVATURE_STEER * clamp(curvature, 0.5, 2.0);
    } else {
      steerBias = 1.0;
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

  // --- Self-registration ---
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
