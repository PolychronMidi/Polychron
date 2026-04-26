// src/conductor/journey/harmonicJourneyPlannerStepBuilder.js
// Extracted from harmonicJourneyPlanner: builds journey stops for sections 1..totalSections-1.

moduleLifecycle.declare({
  name: 'harmonicJourneyPlannerStepBuilder',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['harmonicJourneyPlannerStepBuilder'],
  init: (deps) => {
  const V = deps.validator.create('harmonicJourneyPlannerStepBuilder');
  const DARK_MODES = new Set(['locrian', 'phrygian', 'aeolian']);
  const BRIGHTEN_MODE_MAP = {
    locrian: 'dorian',
    phrygian: 'dorian',
    aeolian: 'mixolydian',
    minor: 'dorian',
    dorian: 'mixolydian'
  };

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
      tonicVisits.set(step.key, (tonicVisits.get(step.key) ?? 0) + 1);
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

      // R8 E3: Minimum harmonic distance guard. When a move produces a key
      // within 2 semitones, retry with development-pool moves to push wider
      // harmonic motion. Skip during resolution (return-home cadences are
      // naturally close). Increases pitchEntropy and audible key contrast.
      const moveDistance = HJ.harmonicDistance(currentKey, nextKey);
      if (moveDistance < 3 && phase !== 'resolution' && steps.length > 0) {
        let appliedWiderKey = false;
        const widerMoves = HJ.getMovePoolForPhase('development');
        for (let dRetry = 0; dRetry < 3; dRetry++) {
          const wFn = widerMoves[ri(widerMoves.length - 1)];
          const wResult = wFn(currentKey, currentMode);
          const wSimplified = t.Note.simplify(wResult.key);
          const wKey = t.Note.pitchClass(wSimplified || wResult.key);
          if (wKey && HJ.harmonicDistance(currentKey, wKey) >= 3) {
            const wDist = HJ.harmonicDistance(currentKey, wKey);
            currentKey = wKey;
            currentMode = wResult.mode;
            appendStep({ key: currentKey, mode: currentMode, move: wResult.move + ' (distance-push)', distance: wDist });
            appliedWiderKey = true;
            break;
          }
        }
        if (appliedWiderKey) continue;
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

        const canReuseCurrentTonic = phase === 'resolution' && currentKey === originKey && V.optionalFinite(tonicVisits.get(currentKey), 0) <= 1;
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

    // R71 E1 / R73 E3: Tonic max-repeat cap. R72 had 4 unique tonics
    // with A repeated (S1 dorian, S2 major). Tightened from ceil(n/2)
    // to ceil(n/3) to enforce stronger tonic diversity: for 5 stops,
    // max 2 appearances of any tonic instead of 3.
    if (steps.length >= 3) {
      const totalStops = 1 + steps.length;
      const maxAllowed = m.max(1, m.ceil(totalStops / 3));
      const tonicCounts = new Map([[originKey, 1]]);
      for (let i = 0; i < steps.length; i++) {
        const k = steps[i].key;
        tonicCounts.set(k, (tonicCounts.get(k) ?? 0) + 1);
      }
      for (const [tonic, count] of tonicCounts) {
        if (count <= maxAllowed) continue;
        let excess = count - maxAllowed;
        for (let i = steps.length - 1; i >= 0 && excess > 0; i--) {
          if (steps[i].key !== tonic) continue;
          const prevKey = i > 0 ? steps[i - 1].key : originKey;
          for (let attempt = 0; attempt < 6; attempt++) {
            const candidate = allNotes[ri(allNotes.length - 1)];
            const candidatePC = t.Note.pitchClass(candidate);
            if (candidatePC && candidatePC !== tonic) {
              steps[i].key = candidatePC;
              steps[i].move = steps[i].move + ' (tonic-cap)';
              steps[i].distance = HJ.harmonicDistance(prevKey, candidatePC);
              excess--;
              break;
            }
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

    // R74 E4: Extended repeat-escape to check S0->S1 transition too.
    // Previously only compared steps[i] vs steps[i-1] starting at i=1,
    // missing the origin-key to first-step adjacency. R73 had Db->Db
    // for S0->S1, producing only 3 unique tonics across 5 sections.
    if (steps.length >= 1) {
      for (let i = 0; i < steps.length; i++) {
        const prevKey = i > 0 ? steps[i - 1].key : originKey;
        const prevMode = i > 0 ? steps[i - 1].mode : originMode;
        if (steps[i].key !== prevKey) continue;
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

    if (steps.length >= 2) {
      const journeyModes = [originMode];
      for (let i = 0; i < steps.length; i++) journeyModes.push(steps[i].mode);
      let darkModeCount = 0;
      let locrianCount = 0;
      for (let i = 0; i < journeyModes.length; i++) {
        const mode = journeyModes[i];
        if (DARK_MODES.has(mode)) darkModeCount++;
        if (mode === 'locrian') locrianCount++;
      }
      const needsBrightening = darkModeCount >= journeyModes.length - 1 || locrianCount >= 2;
      if (needsBrightening) {
        const preferredIndexes = [m.floor(steps.length / 2)];
        if (steps.length >= 4) preferredIndexes.push(steps.length - 2);
        let appliedBrightening = 0;
        for (let i = 0; i < preferredIndexes.length; i++) {
          const idx = preferredIndexes[i];
          const step = steps[idx];
          if (!step || (typeof step.move === 'string' && step.move.indexOf('return-home') === 0)) continue;
          const brightMode = BRIGHTEN_MODE_MAP[step.mode] || 'lydian';
          if (brightMode === step.mode) continue;
          step.mode = brightMode;
          step.move = `parallel-${brightMode} (anti-drift)`;
          appliedBrightening++;
          if ((locrianCount >= 2 && appliedBrightening >= 2) || (darkModeCount >= journeyModes.length - 1 && appliedBrightening >= 1)) {
            break;
          }
        }
      }
    }

    if (steps.length > 0) {
      const firstStep = steps[0];
      if (firstStep && DARK_MODES.has(firstStep.mode)) {
        // R90 E3: Changed fallback from 'lydian' to 'dorian' to reduce lydian bias
        const brighterOpeningMode = BRIGHTEN_MODE_MAP[firstStep.mode] || 'dorian';
        firstStep.mode = brighterOpeningMode;
        firstStep.move = `parallel-${brighterOpeningMode} (frame-brighten)`;
      }
      const lastStep = steps[steps.length - 1];
      if (lastStep && DARK_MODES.has(lastStep.mode) && !(typeof lastStep.move === 'string' && lastStep.move.indexOf('return-home') === 0)) {
        const brighterClosingMode = BRIGHTEN_MODE_MAP[lastStep.mode] || 'mixolydian';
        lastStep.mode = brighterClosingMode;
        lastStep.move = `parallel-${brighterClosingMode} (frame-brighten)`;
      }
    }

    if (steps.length >= 2) {
      const modeCounts = new Map([[originMode, 1]]);
      for (let i = 0; i < steps.length; i++) {
        modeCounts.set(steps[i].mode, (modeCounts.get(steps[i].mode) ?? 0) + 1);
      }
      let dominantMode = '';
      let dominantCount = 0;
      for (const [mode, count] of modeCounts.entries()) {
        if (count > dominantCount) {
          dominantMode = mode;
          dominantCount = count;
        }
      }
      // R1 E5: Palette break at 2+ dominance (was 3). Only 2 modes
      // (major/minor) in R99. Earlier palette break injects modal variety sooner.
      if (dominantCount >= 2) {
        // R90 E3: Fix lydian palette-break bias. Previously the catch-all
        // fallback was always 'lydian', creating a strong lydian attractor.
        // Now cycle through diverse contrast modes based on the dominant mode.
        const PALETTE_BREAK_MAP = {
          dorian: 'mixolydian',
          major: 'minor',
          ionian: 'minor',
          lydian: 'dorian',
          mixolydian: 'dorian',
          minor: 'mixolydian',
          aeolian: 'mixolydian',
          phrygian: 'dorian',
          locrian: 'dorian',
        };
        const paletteBreakMode = PALETTE_BREAK_MAP[dominantMode] || 'dorian';
        const targetIdx = m.floor(steps.length / 2);
        for (let offset = 0; offset < steps.length; offset++) {
          const idx = clamp(targetIdx + (offset % 2 === 0 ? offset : -offset), 0, steps.length - 1);
          const step = steps[idx];
          if (!step || step.mode !== dominantMode) continue;
          if (typeof step.move === 'string' && step.move.indexOf('return-home') === 0) continue;
          step.mode = paletteBreakMode;
          step.move = `parallel-${paletteBreakMode} (palette-break)`;
          break;
        }
      }
    }

    return steps;
  }

  return { buildSteps };
  },
});
