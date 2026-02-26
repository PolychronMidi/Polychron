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

    // Compute raw bias values and apply EMA to prevent discontinuous jumps
    const rawD = 1.0 + (REGIME_DENSITY_DIR[currentRegime] || 0) * MAX_DENSITY * curvatureGain;
    const rawT = 1.0 + (REGIME_TENSION_DIR[currentRegime] || 0) * MAX_TENSION * curvatureGain;
    const rawF = 1.0 + (REGIME_FLICKER_DIR[currentRegime] || 0) * MAX_FLICKER * curvatureGain;
    _smoothedDensity = _smoothedDensity * (1 - BIAS_SMOOTHING) + rawD * BIAS_SMOOTHING;
    _smoothedTension = _smoothedTension * (1 - BIAS_SMOOTHING) + rawT * BIAS_SMOOTHING;
    _smoothedFlicker = _smoothedFlicker * (1 - BIAS_SMOOTHING) + rawF * BIAS_SMOOTHING;
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
