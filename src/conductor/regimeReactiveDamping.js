// @ts-check

/**
 * Regime-Reactive Damping (E4)
 *
 * Reads the current regime from SystemDynamicsProfiler and adjusts
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
    oscillating: -1, // dampen (key target)
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

  let currentRegime = 'evolving';
  let curvatureGain = 0;

  function refresh() {
    const snap = SystemDynamicsProfiler.getSnapshot();
    currentRegime = snap ? snap.regime : 'evolving';
    const rawCurv = snap ? (snap.curvature || 0) : 0;
    curvatureGain = clamp(rawCurv / CURVATURE_CEILING, 0, 1);
  }

  function densityBias() {
    const dir = REGIME_DENSITY_DIR[currentRegime] || 0;
    return 1.0 + dir * MAX_DENSITY * curvatureGain;
  }

  function tensionBias() {
    const dir = REGIME_TENSION_DIR[currentRegime] || 0;
    return 1.0 + dir * MAX_TENSION * curvatureGain;
  }

  function flickerMod() {
    const dir = REGIME_FLICKER_DIR[currentRegime] || 0;
    return 1.0 + dir * MAX_FLICKER * curvatureGain;
  }

  function reset() {
    currentRegime = 'evolving';
    curvatureGain = 0;
  }

  // --- Self-registration ---
  ConductorIntelligence.registerDensityBias('regimeReactiveDamping', densityBias, 0.88, 1.12);
  ConductorIntelligence.registerTensionBias('regimeReactiveDamping', tensionBias, 0.94, 1.06);
  ConductorIntelligence.registerFlickerModifier('regimeReactiveDamping', flickerMod, 0.85, 1.15);
  ConductorIntelligence.registerRecorder('regimeReactiveDamping', refresh);
  ConductorIntelligence.registerModule('regimeReactiveDamping', { reset }, ['section']);

  return { densityBias, tensionBias, flickerMod, reset };
})();
