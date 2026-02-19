// src/conductor/DynamicArchitectPlanner.js - Macro-level dynamic architecture.
// Tracks overall dynamic envelope across the entire piece (pp→ff arc) and
// biases tension to enforce a long-range dynamic plan.
// Pure query API — tension bias drives gradual macro-dynamic shape.

DynamicArchitectPlanner = (() => {
  const MAX_SNAPSHOTS = 64;
  /** @type {Array<{ intensity: number, time: number }>} */
  const snapshots = [];
  let pieceStartTime = -1;
  let estimatedPieceDuration = 180; // default 3 min estimate

  /**
   * Record an intensity snapshot.
   * @param {number} intensity - current composite intensity 0-1
   * @param {number} absTime - absolute time in seconds
   */
  function recordIntensity(intensity, absTime) {
    if (!Number.isFinite(intensity) || !Number.isFinite(absTime)) return;
    if (pieceStartTime < 0) pieceStartTime = absTime;
    snapshots.push({ intensity: clamp(intensity, 0, 1), time: absTime });
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();

    // Refine duration estimate from elapsed time
    const elapsed = absTime - pieceStartTime;
    if (elapsed > estimatedPieceDuration * 0.5) {
      estimatedPieceDuration = m.max(estimatedPieceDuration, elapsed * 1.3);
    }
  }

  /**
   * Get the current macro position in the piece (0-1).
   * @returns {number}
   */
  function getMacroPosition() {
    if (snapshots.length === 0 || pieceStartTime < 0) return 0;
    const latest = snapshots[snapshots.length - 1].time;
    const elapsed = latest - pieceStartTime;
    return clamp(elapsed / estimatedPieceDuration, 0, 1);
  }

  /**
   * Compute the ideal dynamic curve at this macro position.
   * Classic arch: pp → mp → f → ff(climax ~70%) → mf → p → pp(coda)
   * @param {number} position 0-1
   * @returns {number} target intensity 0-1
   */
  function idealDynamicCurve(position) {
    // Piecewise arch peaking at 0.7
    if (position < 0.15) {
      // Opening: gentle ramp 0.2 → 0.4
      return 0.2 + position / 0.15 * 0.2;
    }
    if (position < 0.7) {
      // Building: 0.4 → 0.85 (climax region)
      return 0.4 + (position - 0.15) / 0.55 * 0.45;
    }
    if (position < 0.85) {
      // Post-climax descent: 0.85 → 0.45
      return 0.85 - (position - 0.7) / 0.15 * 0.4;
    }
    // Coda: 0.45 → 0.15
    return 0.45 - (position - 0.85) / 0.15 * 0.3;
  }

  /**
   * Get tension bias to nudge the piece toward the macro dynamic plan.
   * @returns {{ tensionBias: number, macroPosition: number, targetIntensity: number }}
   */
  function getDynamicPlanSignal() {
    const pos = getMacroPosition();
    const target = idealDynamicCurve(pos);

    // Compute recent average intensity
    let recentAvg = 0.5;
    if (snapshots.length >= 3) {
      const recent = snapshots.slice(-5);
      let sum = 0;
      for (let i = 0; i < recent.length; i++) sum += recent[i].intensity;
      recentAvg = sum / recent.length;
    }

    // Tension bias: corrective nudge toward the target
    const deviation = target - recentAvg;
    // Positive deviation → we're below target → increase tension
    // Negative → above target → decrease tension
    const tensionBias = clamp(1 + deviation * 0.25, 0.9, 1.15);

    return { tensionBias, macroPosition: pos, targetIntensity: target };
  }

  /**
   * Get tension multiplier for the derivedTension chain.
   * @returns {number}
   */
  function getTensionBias() {
    return getDynamicPlanSignal().tensionBias;
  }

  /** Reset tracking. */
  function reset() {
    snapshots.length = 0;
    pieceStartTime = -1;
    estimatedPieceDuration = 180;
  }

  return {
    recordIntensity,
    getDynamicPlanSignal,
    getTensionBias,
    reset
  };
})();
