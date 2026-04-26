// src/conductor/harmonicJourneyPlanner.js
// Pure journey-planning helpers extracted from harmonicJourney.planJourney().
// Resolves the starting key/mode and builds subsequent journey steps.

moduleLifecycle.declare({
  name: 'harmonicJourneyPlanner',
  subsystem: 'conductor',
  deps: [],
  provides: ['harmonicJourneyPlanner'],
  init: () => {
  const VALID_MODES = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian', 'ionian'];
  const START_MODE_POOL = ['major', 'minor', 'dorian', 'lydian', 'mixolydian', 'ionian', 'major', 'minor', 'dorian', 'lydian', 'mixolydian', 'ionian', 'aeolian'];

  /**
   * Resolve starting key and mode from planJourney opts.
   * @param {Object} opts
   * @param {string} [opts.startKey]
   * @param {string} [opts.startMode]
   * @returns {{ startKey: string, startMode: string }}
   */
  function resolveStart(opts) {
    let startKey = (opts.startKey === 'random' || !opts.startKey)
      ? allNotes[ri(allNotes.length - 1)]
      : opts.startKey;
    startKey = t.Note.pitchClass(startKey);
    if (!startKey) throw new Error(`harmonicJourney.planJourney: invalid startKey "${opts.startKey}"`);

    let startMode = opts.startMode || 'random';
    if (startMode === 'random') {
      // R2 E1: Regime-responsive mode brightness. Exploring favors darker modes
      // (dorian, minor, phrygian) for drama; coherent favors brighter (major,
      // mixolydian, ionian) for stability. Creates modal diversity organically
      // from regime dynamics rather than post-hoc palette breaks.
      const regimeSnap = systemDynamicsProfiler.getSnapshot();
      const currentRegime = regimeSnap ? regimeSnap.regime : 'exploring';
      // R9 E4: Added locrian for maximum modal darkness during exploring.
      // Locrian's diminished tonic creates extreme harmonic tension, enriching
      // modal variety in exploring passages (previously 6 modes, now 7).
      // R15 E4: Reduce minor bias (2/6->1/6), boost phrygian (1/6->2/6) for
      // darker modal variety. R14 produced only major/minor despite diverse pools.
      const DARK_POOL = ['minor', 'dorian', 'phrygian', 'aeolian', 'phrygian', 'locrian'];
      // R5 E4: Deduplicate BRIGHT_POOL. 'ionian' is identical to 'major'
      // (same scale), doubling major-quality probability (3/6 = 50%). Replace
      // 'ionian' with 'dorian' for modal color variety during coherent regime.
      // R15 E4: Reduce major bias (2/6->1/6), boost lydian (1/6->2/6) for
      // brighter modal color. Lydian's #4 creates distinctive harmonic character.
      const BRIGHT_POOL = ['major', 'mixolydian', 'dorian', 'lydian', 'lydian', 'mixolydian'];
      const modePool = currentRegime === 'exploring' ? DARK_POOL
        : currentRegime === 'coherent' ? BRIGHT_POOL
        : START_MODE_POOL;
      startMode = modePool[ri(modePool.length - 1)];
    }
    if (!VALID_MODES.includes(startMode)) {
      throw new Error(`harmonicJourney.planJourney: invalid startMode "${startMode}"`);
    }

    return { startKey, startMode };
  }

  return { resolveStart, buildSteps: harmonicJourneyPlannerStepBuilder.buildSteps };
  },
});
