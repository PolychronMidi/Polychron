// src/conductor/harmonicJourneyPlanner.js
// Pure journey-planning helpers extracted from harmonicJourney.planJourney().
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
    if (!startKey) throw new Error(`harmonicJourney.planJourney: invalid startKey "${opts.startKey}"`);

    let startMode = opts.startMode || 'random';
    if (startMode === 'random') startMode = VALID_MODES[ri(VALID_MODES.length - 1)];
    if (!VALID_MODES.includes(startMode)) {
      throw new Error(`harmonicJourney.planJourney: invalid startMode "${startMode}"`);
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
    const tonicVisits = new Map([[originKey, 1]]);
    let currentKey = originKey;
    let currentMode = originMode;

    function appendStep(step) {
      steps.push(step);
      tonicVisits.set(step.key, (tonicVisits.get(step.key) || 0) + 1);
    }

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
      // R27 E1: Reduced from 50% to 30% to encourage more harmonic wandering
      const sectionsRemaining = totalSections - s - 1;
      const sectionRoute = totalSections > 1 ? s / (totalSections - 1) : 1;
      const longFormJourney = totalSections >= 5;
      const homeDistance = HJ.harmonicDistance(currentKey, originKey);
      const allowReturnHome = longFormJourney
        ? sectionsRemaining === 0 || (sectionsRemaining === 1 && sectionRoute >= 0.75 && homeDistance >= 4)
        : sectionsRemaining <= 1;
      const returnHomeChance = longFormJourney
        ? (sectionsRemaining === 0 ? 0.42 + clamp((homeDistance - 2) / 4, 0, 1) * 0.38 : 0.12)
        : 0.3;
      if (phase === 'resolution' && allowReturnHome && rf() < returnHomeChance) {
        if (homeDistance > 0) {
          currentKey = originKey;
          currentMode = originMode;
          appendStep({ key: currentKey, mode: currentMode, move: 'return-home', distance: homeDistance });
          continue;
        }
      }

      // Pick a random move from the phase-appropriate pool
      const moveFn = effectivePool[ri(effectivePool.length - 1)];
      const result = moveFn(currentKey, currentMode);

      // simplify normalizes double-sharps/flats (C## - D, B# - C)
      const simplified = t.Note.simplify(result.key);
      const nextKey = t.Note.pitchClass(simplified || result.key);
      if (!nextKey) {
        throw new Error(`harmonicJourney.planJourney: move produced invalid key "${result.key}"`);
      }

      // Consecutive-mode guard: if result preserves the current mode and we have
      // room for variety, retry once with a mode-changing move.
      if (result.mode === currentMode && steps.length > 0) {
        const modeChangers = HJ.getMovePoolForPhase('development');
        const retry = modeChangers[ri(modeChangers.length - 1)](currentKey, currentMode);
        if (retry.mode !== currentMode) {
          const retrySimplified = t.Note.simplify(retry.key);
          const retryKey = t.Note.pitchClass(retrySimplified || retry.key);
          if (retryKey) {
            const dist = HJ.harmonicDistance(currentKey, retryKey);
            currentKey = retryKey;
            currentMode = retry.mode;
            appendStep({ key: currentKey, mode: currentMode, move: retry.move + ' (mode-shift)', distance: dist });
            continue;
          }
        }
      }

      if (nextKey === currentKey) {
        let appliedDistinctKey = false;

        if (effectivePool.length > 1) {
          for (let keyRetry = 0; keyRetry < 3; keyRetry++) {
            const altFn = effectivePool[ri(effectivePool.length - 1)];
            const altResult = altFn(currentKey, currentMode);
            const altSimplified = t.Note.simplify(altResult.key);
            const altKey = t.Note.pitchClass(altSimplified || altResult.key);
            if (altKey && altKey !== currentKey) {
              const altDist = HJ.harmonicDistance(currentKey, altKey);
              currentKey = altKey;
              currentMode = altResult.mode;
              appendStep({ key: currentKey, mode: currentMode, move: altResult.move + ' (key-shift)', distance: altDist });
              appliedDistinctKey = true;
              break;
            }
          }
        }

        const canReuseCurrentTonic = phase === 'resolution' && currentKey === originKey && (tonicVisits.get(currentKey) || 0) <= 1;
        if (!appliedDistinctKey && !canReuseCurrentTonic) {
          for (let forcedRetry = 0; forcedRetry < 5; forcedRetry++) {
            const forcedCandidate = allNotes[ri(allNotes.length - 1)];
            const forcedKey = t.Note.pitchClass(forcedCandidate);
            if (forcedKey && forcedKey !== currentKey) {
              const forcedDist = HJ.harmonicDistance(currentKey, forcedKey);
              currentKey = forcedKey;
              currentMode = result.mode;
              appendStep({ key: currentKey, mode: currentMode, move: result.move + ' (forced-key-shift)', distance: forcedDist });
              appliedDistinctKey = true;
              break;
            }
          }
        }

        if (!appliedDistinctKey) {
          const fallbackDist = HJ.harmonicDistance(currentKey, nextKey);
          currentKey = nextKey;
          currentMode = result.mode;
          appendStep({ key: currentKey, mode: currentMode, move: result.move, distance: fallbackDist });
        }
        continue;
      }

      const dist = HJ.harmonicDistance(currentKey, nextKey);
      currentKey = nextKey;
      currentMode = result.mode;

      appendStep({ key: currentKey, mode: currentMode, move: result.move, distance: dist });
    }

    // Post-hoc tonic diversity check: ensure at least 2 distinct tonics.
    // R35 E1: The key diversity guard (R34 E3) only retries from the same
    // move pool, which often lands on the same tonic. This post-hoc check
    // forces a transposition when all sections share one tonic.
    if (steps.length >= 2) {
      const tonics = new Set([originKey]);
      for (let i = 0; i < steps.length; i++) tonics.add(steps[i].key);
      if (tonics.size < 2) {
        const midIdx = m.floor(steps.length / 2);
        const prevKey = midIdx > 0 ? steps[midIdx - 1].key : originKey;
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = allNotes[ri(allNotes.length - 1)];
          const candidatePC = t.Note.pitchClass(candidate);
          if (candidatePC && candidatePC !== originKey) {
            steps[midIdx].key = candidatePC;
            steps[midIdx].move = steps[midIdx].move + ' (tonic-shift)';
            steps[midIdx].distance = HJ.harmonicDistance(prevKey, candidatePC);
            break;
          }
        }
      }
    }

    // Post-hoc diversity check: ensure mode variety across the journey.
    // For any journey, require at least 2 distinct modes.
    if (steps.length >= 1) {
      const modes = new Set([originMode]);
      for (let i = 0; i < steps.length; i++) modes.add(steps[i].mode);
      const minModes = m.min(2, 1 + steps.length); // at least 2 modes when possible
      if (modes.size < minModes) {
        // Pick the step closest to the midpoint and force a parallel-mode change.
        // Retry up to 5 times to ensure the mode actually differs.
        const midIdx = m.floor(steps.length / 2);
        const parallelMoves = HJ.getMovePoolForPhase('development');
        const prevKey = midIdx > 0 ? steps[midIdx - 1].key : originKey;
        const prevMode = midIdx > 0 ? steps[midIdx - 1].mode : originMode;
        const existingModes = modes;
        let applied = false;

        for (let attempt = 0; attempt < 5 && !applied; attempt++) {
          const moveFn = parallelMoves[ri(parallelMoves.length - 1)];
          const result = moveFn(prevKey, prevMode);
          if (existingModes.has(result.mode)) continue; // same mode - retry
          const simplified = t.Note.simplify(result.key);
          const nextKey = t.Note.pitchClass(simplified || result.key);
          if (nextKey) {
            steps[midIdx].key = nextKey;
            steps[midIdx].mode = result.mode;
            steps[midIdx].move = result.move + ' (diversity)';
            steps[midIdx].distance = HJ.harmonicDistance(prevKey, nextKey);
            applied = true;
          }
        }
      }
    }

    if (steps.length >= 2) {
      for (let i = 1; i < steps.length; i++) {
        if (steps[i].key !== steps[i - 1].key) continue;
        const prevKey = steps[i - 1].key;
        const prevMode = steps[i - 1].mode;
        const replacementPool = HJ.getMovePoolForPhase('development');
        for (let attempt = 0; attempt < 6; attempt++) {
          const moveFn = replacementPool[ri(replacementPool.length - 1)];
          const result = moveFn(prevKey, prevMode);
          const simplified = t.Note.simplify(result.key);
          const nextKey = t.Note.pitchClass(simplified || result.key);
          if (!nextKey || nextKey === prevKey) continue;
          steps[i].key = nextKey;
          steps[i].mode = result.mode;
          steps[i].move = result.move + ' (repeat-escape)';
          steps[i].distance = HJ.harmonicDistance(prevKey, nextKey);
          break;
        }
      }
    }

    if (totalSections >= 4 && steps.length > 0) {
      const lastIdx = steps.length - 1;
      const lastStep = steps[lastIdx];
      const lastHomeDistance = HJ.harmonicDistance(lastStep.key, originKey);
      const hasLateClosure = steps.some(function(step) { return typeof step.move === 'string' && step.move.indexOf('return-home') === 0; });
      const lateClosureDistance = totalSections >= 5 ? 4 : 3;
      if (lastHomeDistance >= lateClosureDistance && !hasLateClosure) {
        const prevKey = lastIdx > 0 ? steps[lastIdx - 1].key : originKey;
        lastStep.key = originKey;
        lastStep.mode = originMode;
        lastStep.move = 'return-home (late-closure)';
        lastStep.distance = HJ.harmonicDistance(prevKey, originKey);
      }
    }

    return steps;
  }

  return { resolveStart, buildSteps };
})();
