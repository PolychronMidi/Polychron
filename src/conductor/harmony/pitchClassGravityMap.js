// src/conductor/pitchClassGravityMap.js - Tonal gravity / pitch-class anchor tracker.
// Tracks which pitch classes carry the most weight (frequency of occurrence)
// and signals tonal center stability vs. drift.
// Pure query API - consumed via conductorState.

moduleLifecycle.declare({
  name: 'pitchClassGravityMap',
  subsystem: 'conductor',
  deps: ['L0', 'conductorIntelligence'],
  lazyDeps: ['analysisHelpers', 'pitchClassHelpers'],
  provides: ['pitchClassGravityMap'],
  init: (deps) => {
  const L0 = deps.L0;
  const conductorIntelligence = deps.conductorIntelligence;
  const WINDOW_SECONDS = 10;

  /**
   * Compute pitch-class distribution and detect gravitational center.
   * @returns {{ center: number, stability: number, driftFromCenter: number, suggestion: string }}
   */
  function getGravitySignal() {
    const { counts: pcCounts, total: totalValid } = pitchClassHelpers.getPitchClassHistogram(WINDOW_SECONDS);

    if (totalValid < 4) {
      return { center: 0, stability: 0.5, driftFromCenter: 0, suggestion: 'maintain' };
    }

    // Find dominant pitch class
    let maxCount = 0;
    let center = 0;
    for (let i = 0; i < 12; i++) {
      if (pcCounts[i] > maxCount) {
        maxCount = pcCounts[i];
        center = i;
      }
    }

    // Stability: how dominant is the center vs. other PCs?
    const centerWeight = maxCount / totalValid;
    // If center has >25% of all notes, it's a strong tonal anchor
    const stability = clamp(centerWeight * 3, 0, 1);

    // Drift: check if recent notes (last quarter) shift away from center
    const notes = L0.query(L0_CHANNELS.note, { windowSeconds: WINDOW_SECONDS });
    const recentPitchClasses = analysisHelpers.extractPCArray(
      analysisHelpers.extractMidiArray(notes).slice(m.floor(notes.length * 0.75)),
      -1
    );
    let recentCenterCount = 0;
    let recentTotal = 0;
    for (let i = 0; i < recentPitchClasses.length; i++) {
      const pitchClass = recentPitchClasses[i];
      if (pitchClass < 0) continue;
      recentTotal++;
      if (pitchClass === center) recentCenterCount++;
    }
    const recentCenterWeight = recentTotal > 0 ? recentCenterCount / recentTotal : centerWeight;
    const driftFromCenter = clamp(centerWeight - recentCenterWeight, -0.5, 0.5);

    let suggestion = 'stable';
    if (stability < 0.25) suggestion = 'ambiguous-center';
    else if (driftFromCenter > 0.15) suggestion = 'drifting-away';
    else if (driftFromCenter < -0.1) suggestion = 'returning';

    return { center, stability, driftFromCenter, suggestion };
  }

  conductorIntelligence.registerStateProvider('pitchClassGravityMap', () => {
    const s = pitchClassGravityMap.getGravitySignal();
    return {
      tonalGravityCenter: s ? s.center : 0,
      tonalGravityStability: s ? s.stability : 0.5,
      tonalGravitySuggestion: s ? s.suggestion : 'maintain'
    };
  });

  function reset() {}
  conductorIntelligence.registerModule('pitchClassGravityMap', { reset }, ['section']);

  return {
    getGravitySignal
  };
  },
});
