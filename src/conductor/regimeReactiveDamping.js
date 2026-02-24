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

  const REGIME_DENSITY = {
    stagnant: 1.12,
    fragmented: 1.0,
    oscillating: 1.0,
    exploring: 1.0,
    coherent: 1.0,
    evolving: 1.0,
    drifting: 0.96,
  };

  const REGIME_TENSION = {
    stagnant: 1.0,
    fragmented: 1.0,
    oscillating: 1.0,
    exploring: 1.06,
    coherent: 1.0,
    evolving: 1.0,
    drifting: 1.04,
  };

  const REGIME_FLICKER = {
    stagnant: 1.10,
    fragmented: 0.92,
    oscillating: 0.88,
    exploring: 1.0,
    coherent: 1.0,
    evolving: 1.0,
    drifting: 1.0,
  };

  let currentRegime = 'evolving';

  function refresh() {
    const snap = SystemDynamicsProfiler.getSnapshot();
    currentRegime = snap ? snap.regime : 'evolving';
  }

  function densityBias() {
    return REGIME_DENSITY[currentRegime] || 1.0;
  }

  function tensionBias() {
    return REGIME_TENSION[currentRegime] || 1.0;
  }

  function flickerMod() {
    return REGIME_FLICKER[currentRegime] || 1.0;
  }

  function reset() {
    currentRegime = 'evolving';
  }

  // --- Self-registration ---
  ConductorIntelligence.registerDensityBias('regimeReactiveDamping', densityBias, 0.90, 1.15);
  ConductorIntelligence.registerTensionBias('regimeReactiveDamping', tensionBias, 0.90, 1.10);
  ConductorIntelligence.registerFlickerModifier('regimeReactiveDamping', flickerMod, 0.85, 1.15);
  ConductorIntelligence.registerRecorder('regimeReactiveDamping', refresh);
  ConductorIntelligence.registerModule('regimeReactiveDamping', { reset }, ['section']);

  return { densityBias, tensionBias, flickerMod, reset };
})();
