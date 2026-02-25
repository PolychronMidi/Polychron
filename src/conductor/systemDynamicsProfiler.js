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
  // Full 6D state space for the coupling matrix (diagnostic exposure).
  // Only the first N_COMPOSITIONAL_DIMS are used for velocity, curvature,
  // coupling strength, and effective dimensionality — because trust
  // (governance meta-signal) and phase (monotonic sawtooth) inflate
  // those metrics without reflecting compositional oscillation.
  const DIM_NAMES = ['density', 'tension', 'flicker', 'entropy', 'trust', 'phase'];
  const N_DIMS = DIM_NAMES.length;
  const N_COMPOSITIONAL_DIMS = 4; // density, tension, flicker, entropy
  const WINDOW = 32; // rolling window for statistics
  const MIN_WINDOW = 6; // minimum beats before meaningful analysis

  // ── State ──
  /** @type {Array<number[]>} smoothed ring buffer for velocity/curvature */
  const trajectory = [];
  /** @type {Array<number[]>} raw ring buffer for coupling/dimensionality */
  const rawTrajectory = [];
  /** @type {Array<number[]>} velocity vectors (first differences) */
  const velocities = [];
  let beatsSeen = 0;

  // Regime hysteresis: requires REGIME_HOLD consecutive beats of a new
  // classification before switching. Prevents single-beat noise from
  // flipping the regime and triggering regime-reactive damping oscillations.
  const REGIME_HOLD = 5; // raised (was 4) — curvature 0.581 near explosive threshold; reduce label flutter
  let _lastRegime = 'evolving';
  let _candidateRegime = 'evolving';
  let _candidateCount = 0;

  // Pre-differentiation EMA: smooths the raw state vector before computing
  // velocity/curvature. Without this, first-differences amplify beat-to-beat
  // noise from 74 independent modules, inflating curvature artificially.
  //
  // Adaptive: the profile's density smoothing already attenuates the noisiest
  // dimension. Heavy profile smoothing (explosive=0.5) needs lighter profiler
  // smoothing; light profile smoothing (default=0.8) needs heavier. Targeting
  // a constant effective responsiveness: profileSmoothing × stateSmoothing ≈ 0.175.
  const _STATE_SMOOTHING_BASELINE = 0.18; // lowered (was 0.22) — velocity 0.009 near-stasis; increase responsiveness
  let _stateSmoothing = 0.30; // conservative default, resolved lazily
  let _stateSmoothingResolved = false;

  // Profile-adaptive oscillating curvature threshold. Explosive profiles
  // naturally produce higher curvature due to wider parameter swings —
  // a fixed 0.5 threshold misclassifies healthy explosive evolution as
  // oscillation. Resolved lazily alongside state smoothing.
  const _OSCILLATING_CURVATURE_DEFAULT = 0.55;
  let _oscillatingCurvatureThreshold = _OSCILLATING_CURVATURE_DEFAULT;

  function _resolveStateSmoothing() {
    if (_stateSmoothingResolved) return;
    try {
      const profileSmoothing = ConductorConfig.getDensitySmoothing();
      _stateSmoothing = clamp(_STATE_SMOOTHING_BASELINE / profileSmoothing, 0.15, 0.40);

      // Scale oscillating threshold by profile character
      const profileName = ConductorConfig.getActiveProfileName();
      if (profileName === 'explosive') _oscillatingCurvatureThreshold = 0.65;
      else if (profileName === 'minimal') _oscillatingCurvatureThreshold = 0.45;
      else _oscillatingCurvatureThreshold = _OSCILLATING_CURVATURE_DEFAULT;
    } catch {
      _stateSmoothing = 0.30;
      _oscillatingCurvatureThreshold = _OSCILLATING_CURVATURE_DEFAULT;
    }
    _stateSmoothingResolved = true;
  }

  /** @type {number[] | null} */
  let _smoothedState = null;

  /** @type {SystemDynamicsSnapshot} */
  let _lastSnapshot = _emptySnapshot();

  /** @returns {SystemDynamicsSnapshot} */
  function _emptySnapshot() {
    return {
      velocity: 0,
      curvature: 0,
      effectiveDimensionality: N_COMPOSITIONAL_DIMS,
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

    // Use raw (unsmoothed) entropy — the EMA-smoothed value converges to
    // near-constant, producing zero variance in the coupling matrix. Raw
    // values preserve the beat-to-beat fluctuations that reveal coupling.
    // Neutral midpoint (0.5) fallback prevents zero-injection on error.
    // Amplify departure from 0.5 by 5× — entropy varies in a narrow band
    // (~0.48–0.52), making its variance invisible to coupling analysis.
    // Amplification increases signal-to-noise in the state vector without
    // altering the actual entropy measurement used elsewhere.
    // Rolled back from 7× after all entropy couplings went to 0.000.
    let entropy = 0.5;
    try {
      const rawE = entropyRegulator.measureRawEntropy();
      entropy = 0.5 + (rawE - 0.5) * 10.0; // raised (was 7.0) — entropy still dead at 7×; 10× safe with pipelineNormalizer absorbing overshoot
    } catch { /* fallback: neutral */ }

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
    // Strength accumulates only compositional pairs (density, tension, flicker,
    // entropy). Trust (governance meta-signal) and phase (monotonic sawtooth)
    // inflate coupling strength without reflecting compositional coherence.
    // Full 6D matrix is still computed for diagnostic exposure.
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
        if (a < N_COMPOSITIONAL_DIMS && b < N_COMPOSITIONAL_DIMS) {
          totalAbs += m.abs(corr);
          pairCount++;
        }
      }
    }

    return { matrix, strength: pairCount > 0 ? totalAbs / pairCount : 0 };
  }

  /**
   * Effective dimensionality: how many independent axes the system is using.
   * Uses variance ratios as a lightweight PCA proxy.
   * If one dimension dominates, effectiveDim ≈ 1. If spread evenly, ≈ N_COMPOSITIONAL_DIMS.
   * Computed as exp(Shannon entropy of normalized variances).
   * Scoped to compositional dimensions only — trust and phase are excluded
   * because they reflect governance/position, not compositional activity.
   * @param {number[]} variance
   * @returns {number} 1.0 to N_COMPOSITIONAL_DIMS
   */
  function _effectiveDimensionality(variance) {
    let total = 0;
    for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) total += variance[d];
    if (total < 1e-12) return 1;

    let entropy = 0;
    for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) {
      const p = variance[d] / total;
      if (p > 1e-12) entropy -= p * m.log(p);
    }
    return clamp(m.exp(entropy), 1, N_COMPOSITIONAL_DIMS);
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
    // Thresholds calibrated for adaptive STATE_SMOOTHING targeting effective
    // responsiveness ≈ 0.175 (profileSmoothing × stateSmoothing). Validated
    // against explosive (0.5 × 0.35) and default (0.8 × 0.22) profiles.
    // Coupling strength and effectiveDim are now scoped to compositional
    // dimensions only (4D, 6 pairs). Thresholds adjusted accordingly.
    // Stagnant: barely moving through state space
    if (avgVelocity < 0.004) return 'stagnant';
    // Oscillating: high curvature (frequent reversals) with moderate velocity.
    // Threshold is profile-adaptive — explosive tolerates higher curvature.
    if (avgCurvature > _oscillatingCurvatureThreshold && avgVelocity < 0.04) return 'oscillating';
    // Exploring: high velocity + varied curvature + multi-dimensional
    if (avgVelocity > 0.02 && effectiveDim > 2.5) return 'exploring';
    // Coherent: strong coupling + moderate velocity (dimensions move together)
    if (couplingStrength > 0.40 && avgVelocity > 0.008) return 'coherent';
    // Fragmented: weak coupling + multi-dimensional (dimensions independent + noisy)
    if (couplingStrength < 0.15 && effectiveDim > 2.5) return 'fragmented';
    // Drifting: moderate velocity, low curvature (slow one-directional change)
    if (avgCurvature < 0.2 && avgVelocity > 0.008) return 'drifting';
    return 'evolving';
  }

  /**
   * Apply hysteresis to regime transitions.
   * Requires REGIME_HOLD consecutive beats of a new classification before switching.
   * Prevents single-beat noise from flip-flopping regime-reactive damping.
   * @param {string} rawRegime - instantaneous classification from _classifyRegime
   * @returns {string} - stable regime with hysteresis
   */
  function _resolveRegime(rawRegime) {
    if (rawRegime === _lastRegime) {
      // Reinforce current regime, reset candidate
      _candidateRegime = rawRegime;
      _candidateCount = 0;
      return _lastRegime;
    }
    if (rawRegime === _candidateRegime) {
      _candidateCount++;
      if (_candidateCount >= REGIME_HOLD) {
        _lastRegime = rawRegime;
        _candidateCount = 0;
        return rawRegime;
      }
    } else {
      // New candidate replaces old
      _candidateRegime = rawRegime;
      _candidateCount = 1;
    }
    return _lastRegime;
  }

  /**
   * Grade the trajectory health.
   * @param {string} regime
   * @returns {string}
   */
  function _grade(regime) {
    if (regime === 'exploring' || regime === 'coherent' || regime === 'evolving') return 'healthy';
    if (regime === 'drifting' || regime === 'fragmented') return 'strained';
    if (regime === 'oscillating') return 'stressed';
    if (regime === 'stagnant') return 'critical';
    return 'healthy';
  }

  /** Run per-beat analysis. Called via ConductorIntelligence recorder. */
  function analyze() {
    beatsSeen++;
    const rawState = _sampleState();

    // EMA smooth the state vector to suppress high-frequency module noise
    // before differentiation. Raw values are used for coupling/variance
    // to avoid EMA-inflated correlations.
    _resolveStateSmoothing();
    if (!_smoothedState) {
      _smoothedState = rawState.slice();
    } else {
      for (let d = 0; d < N_DIMS; d++) {
        _smoothedState[d] = _smoothedState[d] * (1 - _stateSmoothing) + rawState[d] * _stateSmoothing;
      }
    }
    const state = _smoothedState.slice();

    // Smoothed trajectory â†' velocity/curvature (derivatives need smooth input)
    trajectory.push(state);
    if (trajectory.length > WINDOW) trajectory.shift();

    // Raw trajectory â†' coupling/dimensionality (correlations need unsmoothed data)
    rawTrajectory.push(rawState.slice());
    if (rawTrajectory.length > WINDOW) rawTrajectory.shift();

    // Compute velocity (first difference) — compositional dims only.
    // Trust and phase are excluded: trust is a governance meta-signal whose
    // density anti-correlation inflates curvature, and phase is monotonic.
    if (trajectory.length >= 2) {
      const prev = trajectory[trajectory.length - 2];
      const curr = trajectory[trajectory.length - 1];
      const vel = new Array(N_COMPOSITIONAL_DIMS);
      for (let d = 0; d < N_COMPOSITIONAL_DIMS; d++) vel[d] = curr[d] - prev[d];
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

    // â"€â"€ Cross-coupling & effective dimensionality (from RAW trajectory) â"€â"€
    const { mean, variance } = _stats(rawTrajectory);
    const { matrix, strength } = _coupling(rawTrajectory, mean);
    const effDim = _effectiveDimensionality(variance);

    // ── Regime classification (with hysteresis) ──
    const rawRegime = _classifyRegime(avgVelocity, avgCurvature, effDim, strength);
    const regime = _resolveRegime(rawRegime);
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
    rawTrajectory.length = 0;
    velocities.length = 0;
    beatsSeen = 0;
    _smoothedState = null;
    _stateSmoothingResolved = false;
    _stateSmoothing = 0.30;
    _oscillatingCurvatureThreshold = _OSCILLATING_CURVATURE_DEFAULT;
    _lastSnapshot = _emptySnapshot();
    _lastRegime = 'evolving';
    _candidateRegime = 'evolving';
    _candidateCount = 0;
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
  // Scope 'all' — profiler accumulates across sections because trajectory
  // shape (velocity, curvature, coupling) is meaningful across key changes.
  // Section resets were discarding history in short compositions, causing
  // sparse statistics and unreliable regime classification.
  ConductorIntelligence.registerModule('SystemDynamicsProfiler', { reset }, ['all']);

  return { analyze, getSnapshot, getSummary, reset };
})();
