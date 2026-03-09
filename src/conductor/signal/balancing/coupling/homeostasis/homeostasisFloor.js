

/**
 * Homeostasis Floor
 *
 * Structural floor dampening factor and budget constraint pressure
 * computation. When total coupling energy is near the structural
 * minimum, further gain escalation only redistributes energy between
 * pairs. Includes chronic dampening decay to break floor locks.
 */

homeostasisFloor = (() => {
  const { CHRONIC_DAMPEN_THRESHOLD, CHRONIC_FLOOR_RELAX_RATE,
    CHRONIC_FLOOR_RELAX_CAP } = homeostasisConstants;

  /**
   * Structural floor dampening factor for pipelineCouplingManager.
   * Returns 0.20 (near floor) to 1.0 (well above).
   * @returns {number}
   */
  function getFloorDampen() {
    const S = homeostasisState;
    if (S.totalEnergyFloor < 0.1 || S.totalEnergyEma < 0.1) return 1.0;
    const proximity = S.totalEnergyEma / S.totalEnergyFloor;
    const rawDampen = clamp((proximity - 1.0) / 0.35, 0.20, 1.0);
    if (rawDampen < 0.50) {
      S.chronicDampenBeats++;
      if (S.chronicDampenBeats > CHRONIC_DAMPEN_THRESHOLD) {
        const floorMin = S.totalEnergyEma * 0.60;
        if (S.totalEnergyFloor > floorMin) {
          S.totalEnergyFloor = m.max(floorMin, S.totalEnergyFloor * (1 - CHRONIC_FLOOR_RELAX_RATE));
        }
      }
    } else {
      S.chronicDampenBeats = 0;
    }
    if (S.chronicDampenBeats > CHRONIC_DAMPEN_THRESHOLD) {
      const decayBeats = S.chronicDampenBeats - CHRONIC_DAMPEN_THRESHOLD;
      const effectiveMin = m.min(CHRONIC_FLOOR_RELAX_CAP, 0.20 + decayBeats * 0.01);
      return m.max(rawDampen, effectiveMin);
    }
    return rawDampen;
  }

  /** @returns {number} */
  function getBudgetConstraintPressure() {
    const S = homeostasisState;
    const floorPressure = clamp((0.85 - getFloorDampen()) / 0.65, 0, 1);
    const gainPressure = clamp((0.95 - S.globalGainMultiplier) / 0.55, 0, 1);
    const redistributionPressure = clamp(S.nudgeableRedistributionScore / 0.50, 0, 1);
    const tailPressure = clamp(m.max(S.stickyTailPressure, S.tailRecoveryDrive) / 0.60, 0, 1);
    return clamp(m.max(floorPressure, gainPressure, tailPressure, S.tailRecoveryHandshake) * 0.65 + redistributionPressure * 0.20 + tailPressure * 0.08 + S.tailRecoveryHandshake * 0.07, 0, 1);
  }

  return { getFloorDampen, getBudgetConstraintPressure };
})();
