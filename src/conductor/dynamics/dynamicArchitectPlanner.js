// src/conductor/dynamicArchitectPlanner.js - Macro-level dynamic architecture.
// Tracks overall dynamic envelope across the entire piece (pp->ff arc) and
// biases tension to enforce a long-range dynamic plan.
// Pure query API - tension bias drives gradual macro-dynamic shape.

moduleLifecycle.declare({
  name: 'dynamicArchitectPlanner',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['dynamicArchitectPlanner'],
  init: (deps) => {
  const V = deps.validator.create('dynamicArchitectPlanner');
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
    if (position < 0.20) {
      // R12 E1: Opening raised 0.2->0.30, target 0.4->0.45.
      // R20 E1: Opening raised 0.30->0.35, target 0.45->0.50.
      // R21 E5: Extended opening phase 0.15->0.20. Gives the warmer
      // opening more time to establish before the building ramp begins.
      // Q1 kept underperforming (0.694->0.679) because the opening window
      // was too short in shorter pieces (20s for 133s piece).
      // R24 E4: Floor raised 0.35->0.40 to strengthen Q1 (0.686 in R23).
      // Ramp now 0.40-0.50 (was 0.35-0.50), giving a warmer opening.
      // R29 E4: Ramp endpoint 0.50->0.52 to enrich Q1 (0.723 in R28).
      // R34 E2: Floor raised 0.40->0.44 to recover Q1 (0.876->0.771 in R33).
      // R37 E3: Floor raised 0.44->0.48. Q1 dropped 0.855->0.743 in R36.
      // Steeper ramp 0.48-0.52 to recover opening intensity.
      return 0.48 + position / 0.20 * 0.04;
    }
    if (position < 0.7) {
      // Building: 0.50 - 0.95 (climax region)
      // R19 E1: Raised peak from 0.85 to 0.95.
      // R20 E1: Building floor raised 0.45->0.50 to match opening target.
      // R29 E4: Building floor 0.50->0.52 to match opening ramp endpoint.
      return 0.52 + (position - 0.20) / 0.50 * 0.43;
    }
    if (position < 0.85) {
      // R16 E2: Descent target 0.45->0.55 for sustained late-section tension.
      // R19 E1: Descent starts from 0.95 (was 0.85) to match raised peak.
      // R30 E5: Descent floor 0.55->0.58 for sustaining Q4 tension.
      // R32 E2: Revert descent floor 0.58->0.55. Q3/Q4 regressed 2 rounds
      // since R30 E5 (Q3: 0.799->0.656->0.602, Q4: 0.599->0.496->0.450).
      return 0.95 - (position - 0.7) / 0.15 * 0.40;
    }
    // R16 E2: Coda floor 0.20->0.30. Prevents extreme tail-off while
    // maintaining resolution character with more sustained energy.
    // R26 E3: Coda floor 0.30->0.22. Q4 dropped 0.659->0.527 (-0.132)
    // but Q3 also dragged 0.803->0.637 -- too aggressive.
    // R27 E1: Partial revert to 0.26. Keeps improved contrast over old
    // 0.30 while restoring descent arc quality. Range 0.55->0.29.
    // R30 E5: Coda start 0.55->0.58 to match new descent floor.
    // R32 E2: Revert coda start 0.58->0.55 to match reverted descent floor.
    // R35 E4: Coda floor 0.26->0.30. Q4 at 0.585 still weakest quartile.
    // R36 E2: Revert to 0.26. R35 Q4 regressed 0.585->0.485 despite higher
    // floor -- DT gain cap overwhelmed. Restore original coda dynamics.
    return 0.55 - (position - 0.85) / 0.15 * 0.29;
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
    const tensionBias = dynamicArchitectPlannerCtrl.getBias();
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
    dynamicArchitectPlannerCtrl.reset();
  }

  conductorIntelligence.registerTensionBias('dynamicArchitectPlanner', () => dynamicArchitectPlanner.getTensionBias(), 0.9, 1.15);
  conductorIntelligence.registerRecorder('dynamicArchitectPlanner', (ctx) => { if (ctx.layer === 'L2') return; dynamicArchitectPlanner.recordIntensity(ctx.compositeIntensity, ctx.absTime); });
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
  },
});
