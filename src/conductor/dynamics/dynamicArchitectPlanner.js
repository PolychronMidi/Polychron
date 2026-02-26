// src/conductor/dynamicArchitectPlanner.js - Macro-level dynamic architecture.
// Tracks overall dynamic envelope across the entire piece (ppâ†’ff arc) and
// biases tension to enforce a long-range dynamic plan.
// Pure query API - tension bias drives gradual macro-dynamic shape.

dynamicArchitectPlanner = (() => {
  const V = validator.create('dynamicArchitectPlanner');
  const MAX_SNAPSHOTS = 64;
  /** @type {Array<{ intensity: number, time: number }>} */
  const snapshots = [];
  let pieceStartTime = -1;
  let estimatedPieceDuration = 180; // default 3 min estimate

  // Beat-level cache: getDynamicPlanSignal is called 2x per beat (tensionBias + stateProvider)
  const _planCache = beatCache.create(() => _getDynamicPlanSignal());

  /**
   * Record an intensity snapshot.
   * @param {number} intensity - current composite intensity 0-1
   * @param {number} absTime - absolute time in seconds
   */
  function recordIntensity(intensity, absTime) {
    V.requireFinite(intensity, 'intensity');
    V.requireFinite(absTime, 'absTime');
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
   * Classic arch: pp â†’ mp â†’ f â†’ ff(climax ~70%) â†’ mf â†’ p â†’ pp(coda)
   * @param {number} position 0-1
   * @returns {number} target intensity 0-1
   */
  function idealDynamicCurve(position) {
    // Piecewise arch peaking at 0.7
    if (position < 0.15) {
      // Opening: gentle ramp 0.2 â†’ 0.4
      return 0.2 + position / 0.15 * 0.2;
    }
    if (position < 0.7) {
      // Building: 0.4 â†’ 0.85 (climax region)
      return 0.4 + (position - 0.15) / 0.55 * 0.45;
    }
    if (position < 0.85) {
      // Post-climax descent: 0.85 â†’ 0.45
      return 0.85 - (position - 0.7) / 0.15 * 0.4;
    }
    // Coda: 0.45 â†’ 0.15
    return 0.45 - (position - 0.85) / 0.15 * 0.3;
  }

  /**
   * Get tension bias to nudge the piece toward the macro dynamic plan.
   * @returns {{ tensionBias: number, macroPosition: number, targetIntensity: number }}
   */
  function getDynamicPlanSignal() { return _planCache.get(); }

  /** @private */
  function _getDynamicPlanSignal() {
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
    // Positive deviation â†’ we're below target â†’ increase tension
    // Negative â†’ above target â†’ decrease tension
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

  conductorIntelligence.registerTensionBias('dynamicArchitectPlanner', () => dynamicArchitectPlanner.getTensionBias(), 0.9, 1.15);
  conductorIntelligence.registerRecorder('dynamicArchitectPlanner', (ctx) => { dynamicArchitectPlanner.recordIntensity(ctx.compositeIntensity, ctx.absTime); });
  conductorIntelligence.registerStateProvider('dynamicArchitectPlanner', () => {
    const s = dynamicArchitectPlanner.getDynamicPlanSignal();
    return { dynamicPlanMacroPosition: s ? s.macroPosition : 0 };
  });
  conductorIntelligence.registerModule('dynamicArchitectPlanner', { reset }, ['section']);

  return {
    recordIntensity,
    getDynamicPlanSignal,
    getTensionBias,
    reset
  };
})();
