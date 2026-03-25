// src/conductor/dynamicArchitectPlanner.js - Macro-level dynamic architecture.
// Tracks overall dynamic envelope across the entire piece (pp->ff arc) and
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
  const dynamicArchitectPlannerPlanCache = beatCache.create(() => dynamicArchitectPlannerGetDynamicPlanSignal());

  /** Windowed average intensity from recent snapshots. */
  function dynamicArchitectPlannerRecentAvgIntensity() {
    if (snapshots.length < 3) return 0.5;
    const recent = snapshots.slice(-5);
    let sum = 0;
    for (let i = 0; i < recent.length; i++) sum += recent[i].intensity;
    return sum / recent.length;
  }

  // Closed-loop controller: observe recent avg intensity, target the ideal curve
  const dynamicArchitectPlannerCtrl = closedLoopController.create({
    name: 'dynamicArchitectPlanner',
    observe: dynamicArchitectPlannerRecentAvgIntensity,
    target: () => idealDynamicCurve(getMacroPosition()),
    gain: 0.25,
    smoothing: 0,
    clampRange: [0.9, 1.15],
    sourceDomain: 'intensity',
    targetDomain: 'tension'
  });

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
   * Classic arch: pp - mp - f - ff(climax ~70%) - mf - p - pp(coda)
   * @param {number} position 0-1
   * @returns {number} target intensity 0-1
   */
  function idealDynamicCurve(position) {
    // Piecewise arch peaking at 0.7
    if (position < 0.15) {
      // Opening: gentle ramp 0.2 - 0.4
      return 0.2 + position / 0.15 * 0.2;
    }
    if (position < 0.7) {
      // Building: 0.4 - 0.85 (climax region)
      return 0.4 + (position - 0.15) / 0.55 * 0.45;
    }
    if (position < 0.85) {
      // R6 E4: Post-climax descent: 0.85 - 0.55 (was 0.45). Sustain more
      // energy in late sections to prevent tension arc tail-off. Creates
      // a plateau rather than steep drop, maintaining musical interest.
      return 0.85 - (position - 0.7) / 0.15 * 0.30;
    }
    // R6 E4: Coda: 0.55 - 0.25 (was 0.45-0.15). Higher floor maintains
    // presence through the final section.
    return 0.55 - (position - 0.85) / 0.15 * 0.30;
  }

  /**
   * Get tension bias to nudge the piece toward the macro dynamic plan.
   * @returns {{ tensionBias: number, macroPosition: number, targetIntensity: number }}
   */
  function getDynamicPlanSignal() { return dynamicArchitectPlannerPlanCache.get(); }

  /** @private */
  function dynamicArchitectPlannerGetDynamicPlanSignal() {
    const pos = getMacroPosition();
    const target = idealDynamicCurve(pos);
    dynamicArchitectPlannerCtrl.refresh();
    return { tensionBias: dynamicArchitectPlannerCtrl.getBias(), macroPosition: pos, targetIntensity: target };
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
    dynamicArchitectPlannerCtrl.reset();
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
