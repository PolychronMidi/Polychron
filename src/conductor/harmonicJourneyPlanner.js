// src/conductor/harmonicJourneyPlanner.js
// Pure journey-planning helpers extracted from HarmonicJourney.planJourney().
// Resolves the starting key/mode and builds subsequent journey steps.

harmonicJourneyPlanner = (() => {
  const VALID_MODES = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian', 'ionian'];

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
    if (!startKey) throw new Error(`HarmonicJourney.planJourney: invalid startKey "${opts.startKey}"`);

    let startMode = opts.startMode || 'random';
    if (startMode === 'random') startMode = VALID_MODES[ri(VALID_MODES.length - 1)];
    if (!VALID_MODES.includes(startMode)) {
      throw new Error(`HarmonicJourney.planJourney: invalid startMode "${startMode}"`);
    }

    return { startKey, startMode };
  }

  /**
   * Build journey stops for sections 1..totalSections-1 (origin stop not included).
   * Resolution sections bias toward returning home; other sections pick from phase-appropriate moves.
   * @param {number} totalSections
   * @param {string} originKey
   * @param {string} originMode
   * @param {Object} HJ - harmonicJourneyHelpers instance
   * @returns {Array<{key:string, mode:string, move:string, distance:number}>}
   */
  function buildSteps(totalSections, originKey, originMode, HJ) {
    const steps = [];
    let currentKey = originKey;
    let currentMode = originMode;

    for (let s = 1; s < totalSections; s++) {
      const phase = HJ.getSectionPhase(s, totalSections);
      const movePool = HJ.getMovePoolForPhase(phase);

      // Mode diversity guard: if the last 2+ stops share the same mode,
      // bias toward mode-changing moves by injecting parallel-mode from MODERATE_MOVES
      const recentSameMode = steps.length >= 2
        && steps[steps.length - 1].mode === currentMode
        && steps[steps.length - 2].mode === currentMode;
      let effectivePool = movePool;
      if (recentSameMode && phase !== 'climax') {
        // MODERATE_MOVES[0] is the parallel-mode function (always changes mode)
        const modeChanger = HJ.getMovePoolForPhase('development')
          .filter(fn => !movePool.includes(fn));
        effectivePool = [...movePool, ...modeChanger, ...modeChanger];
      }

      // Resolution sections bias toward returning home
      if (phase === 'resolution' && rf() < 0.5) {
        const dist = HJ.harmonicDistance(currentKey, originKey);
        if (dist > 0) {
          currentKey = originKey;
          currentMode = originMode;
          steps.push({ key: currentKey, mode: currentMode, move: 'return-home', distance: dist });
          continue;
        }
      }

      // Pick a random move from the phase-appropriate pool
      const moveFn = effectivePool[ri(effectivePool.length - 1)];
      const result = moveFn(currentKey, currentMode);

      const nextKey = t.Note.pitchClass(result.key);
      if (!nextKey) {
        throw new Error(`HarmonicJourney.planJourney: move produced invalid key "${result.key}"`);
      }

      const dist = HJ.harmonicDistance(currentKey, nextKey);
      currentKey = nextKey;
      currentMode = result.mode;

      steps.push({ key: currentKey, mode: currentMode, move: result.move, distance: dist });
    }

    return steps;
  }

  return { resolveStart, buildSteps };
})();
