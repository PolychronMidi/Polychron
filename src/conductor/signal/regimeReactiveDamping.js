// @ts-check

/**
 * Regime-Reactive Damping (E4)
 *
 * Reads the current regime from systemDynamicsProfiler and adjusts
 * density / tension / flicker biases so the signal pipeline responds
 * appropriately to each dynamical phase.
 *
 * Stagnant  → inject variety (density ↑, flicker ↑)
 * Fragmented → dampen extremes (density → 1, tension → 1)
 * Oscillating → counter-cycle (flicker ↓)
 * Exploring → slight tension lift
 * Coherent / Evolving → neutral (1.0)
 */

regimeReactiveDamping = (() => {

  // --- Base bias per regime (direction only; magnitude scales with curvature) ---
  const REGIME_DENSITY_DIR = {
    stagnant: 1,     // boost
    fragmented: 0,   // neutral
    oscillating: 0,  // neutral
    exploring: 0,    // neutral
    coherent: 0,     // neutral
    evolving: 0,     // neutral
    drifting: -1,    // suppress
  };

  const REGIME_TENSION_DIR = {
    stagnant: 0,
    fragmented: 0,
    oscillating: 0,
    exploring: 1,
    coherent: 0,
    evolving: 0,
    drifting: 1,
  };

  const REGIME_FLICKER_DIR = {
    stagnant: 1,     // boost
    fragmented: -1,  // dampen
    oscillating: 0,  // neutral (was -1 — dampening flicker while density is neutral
                     //   created mechanical anti-correlation r=-0.7 via shared causal path)
    exploring: 0,
    coherent: 0,
    evolving: 0,
    drifting: 0,
  };

  // Max bias magnitude per signal (how far from 1.0 we can go)
  const MAX_DENSITY = 0.12;  // → range 0.88–1.12
  const MAX_TENSION = 0.06;  // → range 0.94–1.06
  const MAX_FLICKER = 0.15;  // → range 0.85–1.15

  // Curvature scaling: bias = 1 + dir * max * curvatureGain
  // At curvature 0 → bias = 1.0 (neutral). At curvature 1.0 → full magnitude.
  const CURVATURE_CEILING = 1.0;

  // EMA smoothing on bias outputs — prevents discontinuous jumps on regime
  // transitions that feed back as self-induced oscillation via the profiler.
  const BIAS_SMOOTHING = 0.20;

  // --- Velocity floor: detect phase-space stasis and inject directional drift ---
  // When velocity stays below threshold for LOW_VEL_BEATS, nudge the least-active
  // axis to restart trajectory movement. This addresses the "near-zero velocity
  // despite evolving regime" problem — the system equilibrates too fast.
  const LOW_VEL_THRESHOLD = 0.015;
  const LOW_VEL_BEATS     = 8;
  const DRIFT_MAGNITUDE   = 0.09;
  const DRIFT_DECAY       = 0.93; // drift decays each beat, replaced when velocity recovers
  let lowVelStreak = 0;
  let _driftD = 0;
  let _driftT = 0;
  let _driftF = 0;
  let _injectionCount = 0; // persistent counter for sign alternation (survives streak resets)

  let currentRegime = 'evolving';
  let curvatureGain = 0;
  let _smoothedDensity = 1.0;
  let _smoothedTension = 1.0;
  let _smoothedFlicker = 1.0;

  function refresh() {
    const snap = systemDynamicsProfiler.getSnapshot();
    currentRegime = snap ? snap.regime : 'evolving';
    const rawCurv = snap ? (snap.curvature || 0) : 0;
    curvatureGain = clamp(rawCurv / CURVATURE_CEILING, 0, 1);

    // --- Velocity floor logic ---
    const velocity = snap ? (snap.velocity || 0) : 0;
    if (velocity < LOW_VEL_THRESHOLD) {
      lowVelStreak++;
    } else {
      lowVelStreak = 0;
      _driftD *= DRIFT_DECAY;
      _driftT *= DRIFT_DECAY;
      _driftF *= DRIFT_DECAY;
    }

    if (lowVelStreak >= LOW_VEL_BEATS && snap && snap.couplingMatrix) {
      // Find the axis with weakest absolute correlation to others —
      // perturbing it has the least chance of cascading through coupling.
      const cm = snap.couplingMatrix;
      const dCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['density-flicker'] || 0);
      const tCoup = m.abs(cm['density-tension'] || 0) + m.abs(cm['tension-flicker'] || 0);
      const fCoup = m.abs(cm['density-flicker'] || 0) + m.abs(cm['tension-flicker'] || 0);

      // Directional: alternate sign using persistent counter to prevent
      // monotonic drift. _injectionCount survives streak resets and section
      // resets, ensuring true alternation across the full composition.
      _injectionCount++;
      const sign = (_injectionCount % 2 === 0) ? 1 : -1;

      if (dCoup <= tCoup && dCoup <= fCoup) {
        _driftD = sign * DRIFT_MAGNITUDE;
      } else if (tCoup <= fCoup) {
        _driftT = sign * DRIFT_MAGNITUDE;
      } else {
        _driftF = sign * DRIFT_MAGNITUDE;
      }
      // Reset streak so drift is injected once per LOW_VEL_BEATS window
      lowVelStreak = 0;
    }

    // Compute raw bias values and apply EMA to prevent discontinuous jumps
    const rawD = 1.0 + (REGIME_DENSITY_DIR[currentRegime] || 0) * MAX_DENSITY * curvatureGain + _driftD;
    const rawT = 1.0 + (REGIME_TENSION_DIR[currentRegime] || 0) * MAX_TENSION * curvatureGain + _driftT;
    const rawF = 1.0 + (REGIME_FLICKER_DIR[currentRegime] || 0) * MAX_FLICKER * curvatureGain + _driftF;
    _smoothedDensity = _smoothedDensity * (1 - BIAS_SMOOTHING) + rawD * BIAS_SMOOTHING;
    _smoothedTension = _smoothedTension * (1 - BIAS_SMOOTHING) + rawT * BIAS_SMOOTHING;
    _smoothedFlicker = _smoothedFlicker * (1 - BIAS_SMOOTHING) + rawF * BIAS_SMOOTHING;

    // Decay drift contribution
    _driftD *= DRIFT_DECAY;
    _driftT *= DRIFT_DECAY;
    _driftF *= DRIFT_DECAY;
  }

  function densityBias() {
    return _smoothedDensity;
  }

  function tensionBias() {
    return _smoothedTension;
  }

  function flickerMod() {
    return _smoothedFlicker;
  }

  function reset() {
    currentRegime = 'evolving';
    curvatureGain = 0;
    _smoothedDensity = 1.0;
    _smoothedTension = 1.0;
    _smoothedFlicker = 1.0;
    // Drift state intentionally NOT reset on section boundaries.
    // The profiler (scope 'all') retains trajectory history across sections,
    // so drift must persist to maintain momentum. lowVelStreak resets to
    // allow re-detection in the new section, but accumulated drift and
    // injection count carry forward.
    lowVelStreak = 0;
  }

  // --- Self-registration ---
  conductorIntelligence.registerDensityBias('regimeReactiveDamping', densityBias, 0.88, 1.12);
  conductorIntelligence.registerTensionBias('regimeReactiveDamping', tensionBias, 0.94, 1.06);
  conductorIntelligence.registerFlickerModifier('regimeReactiveDamping', flickerMod, 0.85, 1.15);
  conductorIntelligence.registerRecorder('regimeReactiveDamping', refresh);
  conductorIntelligence.registerModule('regimeReactiveDamping', { reset }, ['section']);

  feedbackRegistry.registerLoop(
    'regimeReactiveDamping',
    'regime',
    'density',
    () => m.abs(_smoothedDensity - 1.0) / MAX_DENSITY,
    () => m.sign(_smoothedDensity - 1.0)
  );

  return { densityBias, tensionBias, flickerMod, reset };
})();
