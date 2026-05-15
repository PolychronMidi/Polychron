// src/conductor/harmonicJourneyPlanner.js
// Pure journey-planning helpers extracted from harmonicJourney.planJourney().
// Resolves the starting key/mode and builds subsequent journey steps.

moduleLifecycle.declare({
  name: 'harmonicJourneyPlanner',
  subsystem: 'conductor',
  deps: ['systemDynamicsProfiler'],
  lazyDeps: ['harmonicJourneyPlannerStepBuilder'],
  provides: ['harmonicJourneyPlanner'],
  init: (deps) => {
  const systemDynamicsProfiler = deps.systemDynamicsProfiler;
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
      // Regime-responsive mode brightness. Exploring favors darker modes
      const regimeSnap = systemDynamicsProfiler.getSnapshot();
      const currentRegime = regimeSnap ? regimeSnap.regime : 'exploring';
      // Added locrian for maximum modal darkness during exploring.
      const DARK_POOL = ['minor', 'dorian', 'phrygian', 'aeolian', 'phrygian', 'locrian'];
      // Deduplicate BRIGHT_POOL. 'ionian' is identical to 'major'
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
