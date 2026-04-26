

/**
 * Narrative Trajectory Engine (E10)
 *
 * Maintains a 3D trajectory (tension, novelty, density) that describes
 * the musical narrative arc. Computes velocity and curvature of this
 * trajectory and exposes it as conductor state. Registers a tension
 * bias that gently steers away from monotonic trajectories.
 */

moduleLifecycle.declare({
  name: 'narrativeTrajectory',
  subsystem: 'conductor',
  deps: ['conductorIntelligence', 'signalReader', 'systemDynamicsProfiler', 'timeStream', 'validator'],
  lazyDeps: ['conductorState', 'pipelineCouplingManager'],
  provides: ['narrativeTrajectory'],
  init: (deps) => {
  const systemDynamicsProfiler = deps.systemDynamicsProfiler;
  const signalReader = deps.signalReader;
  const timeStream = deps.timeStream;
  const conductorIntelligence = deps.conductorIntelligence;
  const V = deps.validator.create('narrativeTrajectory');

  const HISTORY_LEN      = 16;
  const SMOOTHING        = 0.3;
  const STEER_GAIN       = 0.08;       // R15 E1: 0.10->0.08 moderated; 0.10 over-corrected tension peaks (-20% peak, -27% opening)
  const MONOTONE_THRESHOLD = 0.004;    // R14 E2: 0.002->0.004 detect mild plateaus not just dead-flat
  const CURVATURE_STEER  = 0.06;       // R14 E2: 0.04->0.06 stronger pendulum reversal steering

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
    const s = timeStream.getPosition('section');
    const totalSections = timeStream.getBounds('section');
    if (typeof secProgress === 'number' && Number.isFinite(secProgress)) {
      const edgeDistance = m.min(clamp(secProgress, 0, 1), clamp(1 - secProgress, 0, 1));
      const edgePressure = clamp((0.18 - edgeDistance) / 0.18, 0, 1);
      const axisEnergy = pipelineCouplingManager.getAxisEnergyShare();
      const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
        ? axisEnergy.shares.phase
        : 1.0 / 6.0;
      const trustShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.trust === 'number'
        ? axisEnergy.shares.trust
        : 1.0 / 6.0;
      const lowPhasePressure = clamp((0.12 - phaseShare) / 0.12, 0, 1);
      const phaseRecoveryCredit = clamp((phaseShare - 0.10) / 0.06, 0, 1);
      const trustSharePressure = clamp((trustShare - 0.17) / 0.08, 0, 1);
      const snap = systemDynamicsProfiler.getSnapshot();
      const dynamicSnap = /** @type {any} */ (snap);
      const couplingPressures = pipelineCouplingManager.getCouplingPressures();
      const densityFlickerPressure = clamp((V.optionalFinite(couplingPressures['density-flicker'], 0) - 0.80) / 0.16, 0, 1);
      const tensionFlickerPressure = clamp((V.optionalFinite(couplingPressures['tension-flicker'], 0) - 0.78) / 0.16, 0, 1);
      const tensionProduct = conductorState.getField('tension');
      const tensionSaturationPressure = clamp((tensionProduct - 1.10) / 0.20, 0, 1);
      const evolvingShare = dynamicSnap && typeof dynamicSnap.evolvingShare === 'number'
        ? dynamicSnap.evolvingShare
        : 0;
      const coherentShare = dynamicSnap && typeof dynamicSnap.runCoherentShare === 'number'
        ? dynamicSnap.runCoherentShare
        : 0;
      const evolvingRecoveryPressure = clamp((0.055 - evolvingShare) / 0.055, 0, 1);
      const coherentOvershare = clamp((coherentShare - 0.34) / 0.18, 0, 1);
      const hotspotRelief = clamp(densityFlickerPressure * 0.45 + tensionFlickerPressure * 0.20 + trustSharePressure * 0.25 + lowPhasePressure * 0.30 + tensionSaturationPressure * 0.35, 0, 1);
      if (edgePressure > 0) {
        steerBias = 1.0 + (steerBias - 1.0) * (1 - hotspotRelief * (0.35 + edgePressure * 0.35));
      }
      const midSectionDrive = clamp(1 - edgePressure * 2.2, 0, 1);
      const arcReheat = midSectionDrive * clamp(phaseRecoveryCredit * 0.010 + evolvingRecoveryPressure * 0.014 + coherentOvershare * 0.008 - densityFlickerPressure * 0.01 - tensionFlickerPressure * 0.012 - tensionSaturationPressure * 0.014, 0, 0.024);
      if (arcReheat > 0) {
        steerBias += arcReheat;
      }
      // R74 E2: Section-route-aware back-half recovery. Mid-piece sections
      // (where the tension arc should peak) get amplified recovery force.
      // Edge sections (S0, final S) get base recovery. This creates a
      // structural envelope that lifts Q3/Q4 tension in the compositional
      // core without constant tweaking.
      const sectionRouteForRecovery = totalSections > 1 ? s / (totalSections - 1) : 0;
      const midPieceBoost = 1.0 + m.sin(clamp(sectionRouteForRecovery, 0, 1) * m.PI) * 0.8;
      const backHalfRecovery = secProgress > 0.52
        ? clamp((secProgress - 0.52) / 0.30, 0, 1) * clamp(evolvingRecoveryPressure * 0.014 + coherentOvershare * 0.010 + phaseRecoveryCredit * 0.008 - tensionFlickerPressure * 0.01 - tensionSaturationPressure * 0.012, 0, 0.020) * midPieceBoost
        : 0;
      if (backHalfRecovery > 0) {
        steerBias += backHalfRecovery;
      }
      const finalRelease = secProgress > 0.76
        ? clamp((secProgress - 0.76) / 0.20, 0, 1) * clamp(phaseRecoveryCredit * 0.018 + coherentOvershare * 0.006 + (1 - evolvingRecoveryPressure) * 0.01 - tensionFlickerPressure * 0.006, 0, 0.024)
        : 0;
      if (finalRelease > 0) {
        steerBias = m.max(0.985, steerBias - finalRelease);
      }
      if (tensionSaturationPressure > 0 && steerBias > 1.0) {
        steerBias = 1.0 + (steerBias - 1.0) * (1 - tensionSaturationPressure * 0.85);
      }
      if (secProgress > 0.75) {
        steerBias = m.max(steerBias, 1.0 + 0.006 * (1 - hotspotRelief) * (1 - tensionSaturationPressure * 0.85));
      } else if (secProgress > 0.68) {
        steerBias = m.max(steerBias, 1.0 + clamp(backHalfRecovery + coherentOvershare * 0.006 - hotspotRelief * 0.012 - tensionSaturationPressure * 0.010, 0, 0.016));
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
  },
});
