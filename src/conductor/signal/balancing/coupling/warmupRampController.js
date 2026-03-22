// warmupRampController.js - Hypermeta self-calibrating warmup ramp (#16).
// Replaces hardcoded per-pair warmup beat counts with adaptive ramps
// derived from historical S0 exceedance and section length. Consumed by
// couplingEffectiveGain. Pairs that historically spike during S0 get
// longer ramps; pairs that need immediate decorrelation get shorter ones.

warmupRampController = (() => {

  const _S0_EXCEEDANCE_EMA_ALPHA = 0.10;
  const _SECTION_LENGTH_EMA_ALPHA = 0.08;

  // Per-pair state
  /** @type {Record<string, { s0ExceedanceEma: number, sectionLengthEma: number, currentS0Exceedance: number, lastWarmupBeats: number }>} */
  const warmupRampControllerPairState = {};

  // Track current section state
  let warmupRampControllerCurrentSectionBeats = 0;
  let warmupRampControllerBeatCount = 0;

  // Default warmup ranges per pair category
  const _WARMUP_DEFAULTS = {
    'density-flicker': { base: 12, min: 6, max: 24 },
    _default: { base: 30, min: 16, max: 48 }
  };

  function getPairState(pair) {
    if (!warmupRampControllerPairState[pair]) {
      const defaults = _WARMUP_DEFAULTS[pair] || _WARMUP_DEFAULTS._default;
      warmupRampControllerPairState[pair] = {
        s0ExceedanceEma: 0,
        sectionLengthEma: 60,
        currentS0Exceedance: 0,
        lastWarmupBeats: defaults.base
      };
    }
    return warmupRampControllerPairState[pair];
  }

  /**
   * Record an exceedance event during S0 warmup for a pair.
   * Called by couplingEffectiveGain when a pair exceeds threshold during S0.
   * @param {string} pair
   */
  function recordS0Exceedance(pair) {
    const ps = getPairState(pair);
    ps.currentS0Exceedance++;
  }

  /**
   * Get adaptive warmup beat count for a pair.
   * Longer ramp when S0 exceedance is historically high.
   * Shorter ramp when the pair needs immediate decorrelation.
   * @param {string} pair
   * @returns {number}
   */
  function getWarmupBeats(pair) {
    const ps = getPairState(pair);
    const defaults = _WARMUP_DEFAULTS[pair] || _WARMUP_DEFAULTS._default;

    // Higher S0 exceedance history -> need SHORTER ramp (get decorrelation going)
    // Lower S0 exceedance history -> can afford LONGER ramp (more stability)
    // But very high exceedance -> need moderate ramp to avoid overwhelming
    const exceedancePressure = clamp(ps.s0ExceedanceEma * 5, 0, 1);

    // Section length scaling: shorter sections need shorter ramps
    const sectionScale = clamp(ps.sectionLengthEma / 80, 0.5, 1.5);

    // adaptive warmup: base +/- adjustment
    // When exceedance is moderate (best zone for decorrelation): shorter ramp
    // When exceedance is very high: moderate ramp (prevent oscillation)
    // When exceedance is zero: longer ramp (no urgency, prioritize stability)
    let warmup;
    if (exceedancePressure > 0.7) {
      // Very high exceedance: moderate ramp
      warmup = defaults.base * sectionScale;
    } else if (exceedancePressure > 0.2) {
      // Moderate exceedance: shorter ramp for faster decorrelation
      warmup = defaults.base * 0.7 * sectionScale;
    } else {
      // Low exceedance: longer ramp for stability
      warmup = defaults.base * 1.3 * sectionScale;
    }

    ps.lastWarmupBeats = m.round(clamp(warmup, defaults.min, defaults.max));
    return ps.lastWarmupBeats;
  }

  /**
   * R2 E1: Get a tighter ceiling for a pair during S0 warmup.
   * Ramps linearly from minCeiling to baseCeiling over the warmup window.
   * Returns Infinity outside warmup (no ceiling override).
   * @param {string} pair
   * @param {number} sectionBeat - current beat index within the section
   * @returns {number}
   */
  function getWarmupCeiling(pair, sectionBeat) {
    const ps = getPairState(pair);
    if (sectionBeat >= ps.lastWarmupBeats) return 1 / 0; // Infinity
    const profile = safePreBoot.call(() => {
      const snap = pairGainCeilingController.getSnapshot();
      return snap && snap[pair] ? snap[pair] : null;
    }, null);
    // Fall back to hardcoded defaults if controller not ready
    const minC = profile ? clamp(profile.ceiling * 0.5, 0.02, 0.08) : 0.04;
    const maxC = profile ? profile.ceiling : 0.10;
    const t = ps.lastWarmupBeats > 0 ? sectionBeat / ps.lastWarmupBeats : 1;
    return minC + (maxC - minC) * t;
  }

  function tick() {
    warmupRampControllerBeatCount++;
    warmupRampControllerCurrentSectionBeats++;
  }

  function getSnapshot() {
    const snapshot = {};
    const pairs = Object.keys(warmupRampControllerPairState);
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const ps = warmupRampControllerPairState[pair];
      snapshot[pair] = {
        s0ExceedanceEma: ps.s0ExceedanceEma,
        sectionLengthEma: ps.sectionLengthEma,
        currentS0Exceedance: ps.currentS0Exceedance,
        lastWarmupBeats: ps.lastWarmupBeats
      };
    }
    return {
      beatCount: warmupRampControllerBeatCount,
      currentSectionBeats: warmupRampControllerCurrentSectionBeats,
      pairs: snapshot
    };
  }

  function reset() {
    // On section boundary: finalize S0 exceedance and section length EMAs
    const pairs = Object.keys(warmupRampControllerPairState);
    for (let i = 0; i < pairs.length; i++) {
      const ps = warmupRampControllerPairState[pairs[i]];
      // Update S0 exceedance EMA from this section's data
      const s0Rate = warmupRampControllerCurrentSectionBeats > 0
        ? ps.currentS0Exceedance / m.max(1, m.min(warmupRampControllerCurrentSectionBeats, ps.lastWarmupBeats))
        : 0;
      ps.s0ExceedanceEma += (s0Rate - ps.s0ExceedanceEma) * _S0_EXCEEDANCE_EMA_ALPHA;
      ps.currentS0Exceedance = 0;
      // E5: Section length EMA initialization fix.
      // First section uses high alpha (0.5) to snap to actual length instead
      // of slowly converging from the arbitrary initial value of 60.
      if (warmupRampControllerCurrentSectionBeats > 0) {
        const isFirstSection = warmupRampControllerBeatCount <= warmupRampControllerCurrentSectionBeats + 1;
        const alpha = isFirstSection ? 0.5 : _SECTION_LENGTH_EMA_ALPHA;
        ps.sectionLengthEma += (warmupRampControllerCurrentSectionBeats - ps.sectionLengthEma) * alpha;
      }
    }
    warmupRampControllerCurrentSectionBeats = 0;
  }

  // ===== SELF-REGISTRATION =====
  conductorIntelligence.registerRecorder('warmupRampController', tick);
  conductorIntelligence.registerStateProvider('warmupRampController', () => ({
    warmupRampController: getSnapshot()
  }));
  conductorIntelligence.registerModule('warmupRampController', { reset }, ['section']);

  return {
    recordS0Exceedance,
    getWarmupBeats,
    getWarmupCeiling,
    getSnapshot,
    reset
  };
})();
