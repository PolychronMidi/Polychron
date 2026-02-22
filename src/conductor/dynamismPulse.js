// src/conductor/dynamismPulse.js
// Per-unit probability pulse extracted from DynamismEngine.getUnitPulse().
// Combines measure/beat progress, oscillation, and micro-hyper flicker.

dynamismPulse = (() => {
  /**
   * Compute per-unit pulse so probabilities evolve inside a measure.
   * Includes micro-hyper oscillation: two incommensurate fast sine layers +
   * random spike whose amplitude scales with unit depth and crossModulation.
   * @param {'beat'|'div'|'subdiv'|'subsubdiv'} unit
   * @returns {number} 0-1
   */
  function compute(unit) {
    const measureProgress = clamp(TimeStream.normalizedProgress('measure'), 0, 1);
    const beatProgress = clamp(TimeStream.normalizedProgress('beat'), 0, 1);

    const unitPhase = unit === 'beat' ? 0 : unit === 'div' ? 1.1 : unit === 'subdiv' ? 2.2 : 3.3;
    const unitSeed = Number.isFinite(Number(unitStart)) ? Number(unitStart) : (measureProgress * 137 + beatProgress * 89);
    const osc = (m.sin(unitSeed * 0.0009 + unitPhase) + 1) * 0.5;

    const basePulse = measureProgress * 0.35 + beatProgress * 0.35 + osc * 0.3;

    // ── Micro-hyper flicker (depth-scaled, profile-driven) ─────────────────────
    // Amplitude increases for finer units: beat=0, div=small, subdiv=med, subsubdiv=large
    const baseDepthAmp = unit === 'beat' ? 0 : unit === 'div' ? 0.08 : unit === 'subdiv' ? 0.14 : 0.22;
    const flickerProfile = ConductorConfig.getFlickerParams();
    const depthAmp = baseDepthAmp * flickerProfile.depthScale;

    // Scale flicker amplitude with crossModulation feedback:
    // dense rhythmic activity → wider flicker → more textural contrast
    const crossModAmp = (Number.isFinite(crossModulation))
      ? clamp(crossModulation / 6, 0, 1) // crossMod typically ranges ~0–6
      : flickerProfile.crossModWeight;
    const flickerScale = depthAmp * (0.5 + 0.5 * crossModAmp);

    // Two incommensurate noise samples for organic non-repeating flicker
    const flicker1 = defaultSimplex.noise(unitSeed * 0.0037, unitPhase * 2.7) * flickerScale;
    const flicker2 = defaultSimplex.noise(unitSeed * 0.0071, -unitPhase * 4.1) * flickerScale * 0.7;
    const spike = rf(-1, 1) * flickerScale * 0.4;

    return clamp(basePulse + flicker1 + flicker2 + spike, 0, 1);
  }

  return { compute };
})();
