// src/conductor/repetitionFatigueMonitor.js - Detects exact pitch-sequence repetition.
// Flags melodic loops/ruts at short timescales (2-6 note patterns recurring within 4s).
// Pure query API - penalty weight for VoiceLeadingScore or composer note selection.

repetitionFatigueMonitor = (() => {
  const V = validator.create('repetitionFatigueMonitor');
  const WINDOW_SECONDS = 4;
  const MIN_PATTERN = 2;
  const MAX_PATTERN = 6;

  /**
   * Detect repeating pitch-class sequences in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ fatigueLevel: number, repeatedPatterns: number, totalPatterns: number, fatigued: boolean }}
   */
  function getRepetitionProfile(opts = {}) {
    const notes = analysisHelpers.getWindowNotes(V, opts, WINDOW_SECONDS);
    if (notes.length < MIN_PATTERN * 2) {
      return { fatigueLevel: 0, repeatedPatterns: 0, totalPatterns: 0, fatigued: false };
    }

    const pitches = analysisHelpers.extractPCArray(analysisHelpers.extractMidiArray(notes, 0), 0);

    // Check for exact n-gram repetitions
    let repeatedCount = 0;
    let checkedCount = 0;

    for (let len = MIN_PATTERN; len <= m.min(MAX_PATTERN, m.floor(pitches.length / 2)); len++) {
      const seen = /** @type {Object.<string, number>} */ ({});
      for (let i = 0; i <= pitches.length - len; i++) {
        const key = pitches.slice(i, i + len).join(',');
        seen[key] = (V.optionalFinite(seen[key], 0)) + 1;
        checkedCount++;
      }
      const keys = Object.keys(seen);
      for (let k = 0; k < keys.length; k++) {
        const count = seen[keys[k]];
        if (typeof count === 'number' && count > 1) {
          repeatedCount += count - 1;
        }
      }
    }

    const fatigueLevel = checkedCount > 0 ? clamp(repeatedCount / checkedCount, 0, 1) : 0;

    return {
      fatigueLevel,
      repeatedPatterns: repeatedCount,
      totalPatterns: checkedCount,
      fatigued: fatigueLevel > 0.3
    };
  }

  /**
   * Get a repetition penalty multiplier for note selection.
   * High fatigue - stronger penalty against repeated pitches.
   * Continuous interpolation avoids chronic ceiling-lock.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {number} - 1.0 (no penalty) to 1.15 (strong penalty)
   */
  function getRepetitionPenalty(opts) {
    const profile = getRepetitionProfile(opts);
    // Continuous ramp: onset at 0.20, full at 1.0. Reduced from 0.15 to 0.12
    // max to ease tension crush - output 1.143 consuming 95% of [1, 1.15] range.
    if (profile.fatigueLevel <= 0.20) return 1.0;
    const ramp = clamp((profile.fatigueLevel - 0.20) / 0.80, 0, 1);
    let penalty = 1.0 + ramp * 0.12;
    const secProgress = safePreBoot.call(() => timeStream.normalizedProgress('section'), 0.5);
    const edgeDistance = typeof secProgress === 'number' && Number.isFinite(secProgress)
      ? m.min(clamp(secProgress, 0, 1), clamp(1 - secProgress, 0, 1))
      : 0.5;
    const edgePressure = clamp((0.18 - edgeDistance) / 0.18, 0, 1);
    const axisEnergy = safePreBoot.call(() => pipelineCouplingManager.getAxisEnergyShare(), null);
    const phaseShare = axisEnergy && axisEnergy.shares && typeof axisEnergy.shares.phase === 'number'
      ? axisEnergy.shares.phase
      : 1.0 / 6.0;
    const lowPhasePressure = clamp((0.12 - phaseShare) / 0.12, 0, 1);
    const snap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
    const couplingMatrix = snap && snap.couplingMatrix ? snap.couplingMatrix : null;
    const densityFlickerPressure = couplingMatrix && typeof couplingMatrix['density-flicker'] === 'number' && Number.isFinite(couplingMatrix['density-flicker'])
      ? clamp((m.abs(couplingMatrix['density-flicker']) - 0.80) / 0.16, 0, 1)
      : 0;
    const relief = clamp(edgePressure * 0.40 + lowPhasePressure * 0.30 + densityFlickerPressure * 0.30, 0, 0.75);
    penalty = 1.0 + (penalty - 1.0) * (1 - relief);
    return penalty;
  }

  conductorIntelligence.registerTensionBias('repetitionFatigueMonitor', () => repetitionFatigueMonitor.getRepetitionPenalty(), 1, 1.12);

  return {
    getRepetitionProfile,
    getRepetitionPenalty
  };
})();
