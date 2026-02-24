// systemDynamicsProfiler.js — Phase-space trajectory analysis of the signal organism.
// Treats the entire system as a dynamical entity moving through a multi-dimensional
// state space. Analyzes the SHAPE of that movement — not individual pipelines, but
// the emergent geometry of how all dimensions co-evolve.
//
// Five metrics, each invisible to single-pipeline analyzers:
//   1. Trajectory velocity — how fast the state is changing (stuck vs evolving)
//   2. Trajectory curvature — turning behavior (straight vs winding)
//   3. Cross-coupling — rolling correlations between dimension pairs
//   4. Effective dimensionality — how many independent axes are in use
//   5. Regime detection — qualitative shifts in system operating mode
//
// Does NOT modify signal values — pure observation + diagnostics.

SystemDynamicsProfiler = (() => {
  // ── Phase space dimensions ──
  const DIM_NAMES = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];
  const N_DIMS = DIM_NAMES.length;
  const WINDOW = 32; // rolling window for statistics
  const MIN_WINDOW = 6; // minimum beats before meaningful analysis

  // ── State ──
  /** @type {Array<number[]>} ring buffer of state vectors */
  const trajectory = [];
  /** @type {Array<number[]>} velocity vectors (first differences) */
  const velocities = [];
  let beatsSeen = 0;

  // Pre-differentiation EMA: smooths the raw state vector before computing
  // velocity/curvature. Without this, first-differences amplify beat-to-beat
  // noise from 74 independent modules, inflating curvature artificially.
  // The smoothing factor matches the musical output's effective responsiveness.
  const STATE_SMOOTHING = 0.35;
  /** @type {number[] | null} */
  let _smoothedState = null;

  /** @type {SystemDynamicsSnapshot} */
  let _lastSnapshot = _emptySnapshot();

  /** @returns {SystemDynamicsSnapshot} */
  function _emptySnapshot() {
    return {
      velocity: 0,
      curvature: 0,
      effectiveDimensionality: N_DIMS,
      couplingStrength: 0,
      regime: 'initializing',
      grade: 'healthy',
      couplingMatrix: {}
    };
  }

  // ── Vector math helpers (no dependencies) ──

  /** @param {number[]} v @returns {number} */
  function _magnitude(v) {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    return m.sqrt(sum);
  }

  /** @param {number[]} a @param {number[]} b @returns {number} cosine similarity [-1, 1] */
  function _cosine(a, b) {
    let dot = 0;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      ma += a[i] * a[i];
      mb += b[i] * b[i];
    }
    const denom = m.sqrt(ma) * m.sqrt(mb);
    if (denom < 1e-10) return 0;
    return clamp(dot / denom, -1, 1);
  }

  // ── Core analysis ──

  /** Sample the current state vector from live signal data. @returns {number[]} */
  function _sampleState() {
    const snap = signalReader.snapshot();
    let avgTrust = 0;
    let trustCount = 0;
    try {
      const ts = AdaptiveTrustScores.getSnapshot();
      const entries = Object.values(ts);
      for (let i = 0; i < entries.length; i++) {
        if (entries[i] && typeof entries[i].score === 'number') {
          avgTrust += entries[i].score;
          trustCount++;
        }
      }
      if (trustCount > 0) avgTrust /= trustCount;
    } catch { /* non-fatal */ }

    let entropy = 0;
    try { entropy = CoherenceMonitor.getEntropySignal(); } catch { /* non-fatal */ }

    let phase = 0;
    try { phase = TimeStream.normalizedProgress('section'); } catch { /* non-fatal */ }

    return [
      snap.densityProduct,
      snap.tensionProduct,
      snap.flickerProduct,
      entropy,
      avgTrust,
      phase
    ];
  }

  /**
   * Compute rolling mean & variance per dimension.
   * @param {Array<number[]>} data
   * @returns {{ mean: number[], variance: number[] }}
   */
  function _stats(data) {
    const n = data.length;
    const mean = new Array(N_DIMS).fill(0);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < N_DIMS; d++) mean[d] += data[i][d];
    }
    for (let d = 0; d < N_DIMS; d++) mean[d] /= n;

    const variance = new Array(N_DIMS).fill(0);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < N_DIMS; d++) {
        const diff = data[i][d] - mean[d];
        variance[d] += diff * diff;
      }
    }
    for (let d = 0; d < N_DIMS; d++) variance[d] /= n;

    return { mean, variance };
  }

  /**
   * Compute cross-coupling: rolling correlation matrix between dimension pairs.
   * Returns only upper triangle as { 'density-tension': 0.85, ... }.
   * @param {Array<number[]>} data
   * @param {number[]} mean
   * @returns {{ matrix: Record<string, number>, strength: number }}
   */
  function _coupling(data, mean) {
    const n = data.length;
    /** @type {Record<string, number>} */
    const matrix = {};
    let totalAbs = 0;
    let pairCount = 0;

    for (let a = 0; a < N_DIMS; a++) {
      for (let b = a + 1; b < N_DIMS; b++) {
        let covAB = 0;
        let varA = 0;
        let varB = 0;
        for (let i = 0; i < n; i++) {
          const da = data[i][a] - mean[a];
          const db = data[i][b] - mean[b];
          covAB += da * db;
          varA += da * da;
          varB += db * db;
        }
        const denom = m.sqrt(varA * varB);
        const corr = denom > 1e-10 ? covAB / denom : 0;
        const key = DIM_NAMES[a] + '-' + DIM_NAMES[b];
        matrix[key] = m.round(corr * 1000) / 1000;
        totalAbs += m.abs(corr);
        pairCount++;
      }
    }

    return { matrix, strength: pairCount > 0 ? totalAbs / pairCount : 0 };
  }

  /**
   * Effective dimensionality: how many independent axes the system is using.
   * Uses variance ratios as a lightweight PCA proxy.
   * If one dimension dominates, effectiveDim ≈ 1. If spread evenly, ≈ N_DIMS.
   * Computed as exp(Shannon entropy of normalized variances).
   * @param {number[]} variance
   * @returns {number} 1.0 to N_DIMS
   */
  function _effectiveDimensionality(variance) {
    let total = 0;
    for (let d = 0; d < N_DIMS; d++) total += variance[d];
    if (total < 1e-12) return 1;

    let entropy = 0;
    for (let d = 0; d < N_DIMS; d++) {
      const p = variance[d] / total;
      if (p > 1e-12) entropy -= p * m.log(p);
    }
    return clamp(m.exp(entropy), 1, N_DIMS);
  }

  /**
   * Classify the current operating regime based on velocity and curvature patterns.
   * @param {number} avgVelocity
   * @param {number} avgCurvature
   * @param {number} effectiveDim
   * @param {number} couplingStrength
   * @returns {string}
   */
  function _classifyRegime(avgVelocity, avgCurvature, effectiveDim, couplingStrength) {
    // Thresholds calibrated for STATE_SMOOTHING = 0.35 EMA on the state vector.
    // Smoothing reduces velocity by ~60% and curvature by ~40% vs raw values.
    // Stagnant: barely moving through state space
    if (avgVelocity < 0.004) return 'stagnant';
    // Oscillating: high curvature (frequent reversals) with moderate velocity
    if (avgCurvature > 0.5 && avgVelocity < 0.04) return 'oscillating';
    // Exploring: high velocity + varied curvature + multi-dimensional
    if (avgVelocity > 0.02 && effectiveDim > 2.5) return 'exploring';
    // Coherent: strong coupling + moderate velocity (dimensions move together)
    if (couplingStrength > 0.45 && avgVelocity > 0.008) return 'coherent';
    // Fragmented: weak coupling + multi-dimensional (dimensions independent + noisy)
    if (couplingStrength < 0.2 && effectiveDim > 3) return 'fragmented';
    // Drifting: moderate velocity, low curvature (slow one-directional change)
    if (avgCurvature < 0.2 && avgVelocity > 0.008) return 'drifting';
    return 'evolving';
  }

  /**
   * Grade the trajectory health.
   * @param {string} regime
   * @returns {string}
   */
  function _grade(regime) {
    if (regime === 'exploring' || regime === 'coherent' || regime === 'evolving') return 'healthy';
    if (regime === 'drifting') return 'strained';
    if (regime === 'oscillating' || regime === 'fragmented') return 'stressed';
    if (regime === 'stagnant') return 'critical';
    return 'healthy';
  }

  /** Run per-beat analysis. Called via ConductorIntelligence recorder. */
  function analyze() {
    beatsSeen++;
    const rawState = _sampleState();

    // EMA smooth the state vector to suppress high-frequency module noise
    // before differentiation. Raw values are still used for coupling/variance.
    if (!_smoothedState) {
      _smoothedState = rawState.slice();
    } else {
      for (let d = 0; d < N_DIMS; d++) {
        _smoothedState[d] = _smoothedState[d] * (1 - STATE_SMOOTHING) + rawState[d] * STATE_SMOOTHING;
      }
    }
    const state = _smoothedState.slice();

    // Maintain rolling window
    trajectory.push(state);
    if (trajectory.length > WINDOW) trajectory.shift();

    // Compute velocity (first difference)
    if (trajectory.length >= 2) {
      const prev = trajectory[trajectory.length - 2];
      const curr = trajectory[trajectory.length - 1];
      const vel = new Array(N_DIMS);
      for (let d = 0; d < N_DIMS; d++) vel[d] = curr[d] - prev[d];
      velocities.push(vel);
      if (velocities.length > WINDOW) velocities.shift();
    }

    // Need minimum history for meaningful analysis
    if (trajectory.length < MIN_WINDOW) return;

    // ── Trajectory velocity (mean magnitude of velocity vectors) ──
    let avgVelocity = 0;
    for (let i = 0; i < velocities.length; i++) {
      avgVelocity += _magnitude(velocities[i]);
    }
    avgVelocity /= m.max(1, velocities.length);

    // ── Trajectory curvature (mean angle between consecutive velocities) ──
    let avgCurvature = 0;
    let curvCount = 0;
    for (let i = 1; i < velocities.length; i++) {
      const cos = _cosine(velocities[i - 1], velocities[i]);
      // curvature = 1 - cos: 0 = straight, 1 = right angle, 2 = reversal
      avgCurvature += 1 - cos;
      curvCount++;
    }
    if (curvCount > 0) avgCurvature /= curvCount;

    // ── Cross-coupling & effective dimensionality ──
    const { mean, variance } = _stats(trajectory);
    const { matrix, strength } = _coupling(trajectory, mean);
    const effDim = _effectiveDimensionality(variance);

    // ── Regime classification ──
    const regime = _classifyRegime(avgVelocity, avgCurvature, effDim, strength);
    const grade = _grade(regime);

    _lastSnapshot = {
      velocity: m.round(avgVelocity * 10000) / 10000,
      curvature: m.round(avgCurvature * 1000) / 1000,
      effectiveDimensionality: m.round(effDim * 100) / 100,
      couplingStrength: m.round(strength * 1000) / 1000,
      regime,
      grade,
      couplingMatrix: matrix
    };

    // Emit diagnostics on non-healthy beats
    if (grade !== 'healthy') {
      ExplainabilityBus.emit('system-dynamics', 'both', {
        regime,
        grade,
        velocity: _lastSnapshot.velocity,
        curvature: _lastSnapshot.curvature,
        effectiveDimensionality: _lastSnapshot.effectiveDimensionality,
        couplingStrength: _lastSnapshot.couplingStrength
      }, beatStartTime * 1000);
    }
  }

  /** @returns {SystemDynamicsSnapshot} */
  function getSnapshot() { return _lastSnapshot; }

  /**
   * End-of-run summary for system manifest.
   * @returns {SystemDynamicsSummary}
   */
  function getSummary() {
    return {
      beatsAnalyzed: beatsSeen,
      snapshot: _lastSnapshot,
      dimensionNames: DIM_NAMES.slice()
    };
  }

  function reset() {
    trajectory.length = 0;
    velocities.length = 0;
    beatsSeen = 0;
    _smoothedState = null;
    _lastSnapshot = _emptySnapshot();
  }

  // ── Self-register ──
  ConductorIntelligence.registerRecorder('SystemDynamicsProfiler', () => { SystemDynamicsProfiler.analyze(); });
  ConductorIntelligence.registerStateProvider('SystemDynamicsProfiler', () => ({
    dynamicsRegime: _lastSnapshot.regime,
    dynamicsGrade: _lastSnapshot.grade,
    dynamicsVelocity: _lastSnapshot.velocity,
    dynamicsCurvature: _lastSnapshot.curvature,
    dynamicsEffectiveDim: _lastSnapshot.effectiveDimensionality,
    dynamicsCouplingStrength: _lastSnapshot.couplingStrength
  }));
  ConductorIntelligence.registerModule('SystemDynamicsProfiler', { reset }, ['section']);

  return { analyze, getSnapshot, getSummary, reset };
})();
