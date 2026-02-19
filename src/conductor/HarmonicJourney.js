// HarmonicJourney.js - Tonal center trajectory engine for cross-section/cross-layer coherence.
//
// Plans a key/mode journey across sections using music-theory relationships
// (circle of fifths, relative major/minor, parallel modes, chromatic mediants).
// Drives HarmonicContext at section/phrase boundaries so every downstream consumer
// (ChordComposer, MelodicDevelopmentComposer, voiceLeadingPriors, melodicPriors,
// MotifComposer, scaleNormalization) responds automatically without modification.
//
// Design principles:
//   - Every relationship is a *generative rule*, not a conformity constraint.
//   - Each run produces a unique journey; no two compositions follow the same path.
//   - Arc-aligned boldness: opening/resolution stay close, climax allows distant moves.
//   - L2 gets a *complementary* relationship to L1 (same key, relative, or parallel).

/**
 * @typedef {Object} JourneyStop
 * @property {string} key     - Pitch class (e.g., 'C', 'G', 'Eb')
 * @property {string} mode    - Mode name (e.g., 'major', 'dorian', 'minor')
 * @property {string} move    - Relationship label used to reach this stop
 * @property {number} distance - Semitone distance from previous stop (0 for origin)
 */

HarmonicJourney = (() => {
  const V = Validator.create('HarmonicJourney');

  if (typeof harmonicJourneyHelpers !== 'function') {
    throw new Error('HarmonicJourney: harmonicJourneyHelpers() not available');
  }
  const HJ = harmonicJourneyHelpers();

  /** @type {JourneyStop[]} */
  let plan = [];
  let originKey = 'C';
  let originMode = 'major';
  let currentStopIndex = 0;

  /**
   * Plans a key/mode journey for the full composition.
   * Called once at composition start from main.js.
   * @param {number} totalSections - Total number of sections
   * @param {Object} [opts]
   * @param {string} [opts.startKey] - Starting key ('random' or pitch class)
   * @param {string} [opts.startMode] - Starting mode ('random' or mode name)
   * @returns {JourneyStop[]} The planned journey
   */
  function planJourney(totalSections, opts = {}) {
    if (!Number.isInteger(totalSections) || totalSections <= 0) {
      throw new Error('HarmonicJourney.planJourney: totalSections must be a positive integer');
    }
    if (typeof t === 'undefined' || !t || !t.Note || !t.Key) {
      throw new Error('HarmonicJourney.planJourney: Tonal.js (t) not available');
    }

    // Resolve starting key
    let startKey = (opts.startKey === 'random' || !opts.startKey)
      ? allNotes[ri(allNotes.length - 1)]
      : opts.startKey;
    startKey = t.Note.pitchClass(startKey);
    if (!startKey) throw new Error(`HarmonicJourney.planJourney: invalid startKey "${opts.startKey}"`);

    // Resolve starting mode
    const validModes = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian', 'ionian'];
    let startMode = opts.startMode || 'random';
    if (startMode === 'random') {
      startMode = validModes[ri(validModes.length - 1)];
    }
    if (!validModes.includes(startMode)) {
      throw new Error(`HarmonicJourney.planJourney: invalid startMode "${startMode}"`);
    }

    originKey = startKey;
    originMode = startMode;
    plan = [{ key: startKey, mode: startMode, move: 'origin', distance: 0 }];

    let currentKey = startKey;
    let currentMode = startMode;

    for (let s = 1; s < totalSections; s++) {
      const phase = HJ.getSectionPhase(s, totalSections);
      const movePool = HJ.getMovePoolForPhase(phase);

      // Resolution sections bias toward returning home
      if (phase === 'resolution' && rf() < 0.5) {
        const dist = HJ.harmonicDistance(currentKey, originKey);
        if (dist > 0) {
          currentKey = originKey;
          currentMode = originMode;
          plan.push({ key: currentKey, mode: currentMode, move: 'return-home', distance: dist });
          continue;
        }
      }

      // Pick a random move from the phase-appropriate pool
      const moveFn = movePool[ri(movePool.length - 1)];
      const result = moveFn(currentKey, currentMode);

      // Normalize key to pitch class
      const nextKey = t.Note.pitchClass(result.key);
      if (!nextKey) {
        throw new Error(`HarmonicJourney.planJourney: move produced invalid key "${result.key}"`);
      }

      const dist = HJ.harmonicDistance(currentKey, nextKey);
      currentKey = nextKey;
      currentMode = result.mode;

      plan.push({ key: currentKey, mode: currentMode, move: result.move, distance: dist });
    }

    currentStopIndex = 0;
    return plan.slice();
  }

  /**
   * Gets the journey stop for a given section index.
   * @param {number} sectionIndex
   * @returns {JourneyStop}
   */
  function getStop(sectionIndex) {
    if (plan.length === 0) throw new Error('HarmonicJourney.getStop: journey not planned yet');
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
      throw new Error('HarmonicJourney.getStop: sectionIndex must be a non-negative integer');
    }
    const idx = m.min(sectionIndex, plan.length - 1);
    return plan[idx];
  }

  /**
   * Apply the journey stop for the current section to HarmonicContext.
   * Called at each section boundary in main.js.
   * @param {number} sectionIndex
   */
  function applyToContext(sectionIndex) {
    if (typeof HarmonicContext === 'undefined' || !HarmonicContext || typeof HarmonicContext.set !== 'function') {
      throw new Error('HarmonicJourney.applyToContext: HarmonicContext not available');
    }

    const stop = getStop(sectionIndex);
    currentStopIndex = sectionIndex;

    // Use Tonal.js to derive scale from key+mode
    const resolved = HJ.resolveScaleAndQuality(stop.key, stop.mode);

    // Calculate dynamic structural parameters
    const totalSections = plan.length;
    const currentPhase = HJ.getSectionPhase(sectionIndex, totalSections);

    // Calculate excursion (distance from origin)
    // Note: stop.distance is the step distance; we want total distance from start
    const excursion = HJ.harmonicDistance(stop.key, originKey);

    HarmonicContext.set({
      key: stop.key,
      mode: stop.mode,
      quality: resolved.quality,
      scale: resolved.scaleNotes,
      excursion: excursion,
      sectionPhase: currentPhase
    });

    // Emit journey-move event for rhythm-harmonic coupling
    if (typeof EventBus !== 'undefined' && EventBus && typeof EventBus.emit === 'function') {
      const EVENTS = V.getEventsOrThrow();
      EventBus.emit(EVENTS.JOURNEY_MOVE, {
        move: stop.move,
        distance: stop.distance,
        key: stop.key,
        mode: stop.mode,
        sectionIndex
      });
    }
  }

  /**
   * Compute a complementary key/mode for L2 based on L1's current stop.
   * @param {number} sectionIndex
   * @returns {{ key: string, mode: string, relationship: string }}
   */
  function getL2Complement(sectionIndex) {
    const l1Stop = getStop(sectionIndex);
    const relationships = HJ.getL2Relationships();
    const relFn = relationships[ri(relationships.length - 1)];
    const result = relFn(l1Stop.key, l1Stop.mode);

    // Normalize key
    const normalized = t.Note.pitchClass(result.key);
    if (!normalized) {
      throw new Error(`HarmonicJourney.getL2Complement: relationship produced invalid key "${result.key}"`);
    }

    return { key: normalized, mode: result.mode, relationship: result.relationship };
  }

  /**
   * Apply L2 complement to HarmonicContext (called when L2 activates).
   * @param {number} sectionIndex
   */
  function applyL2ToContext(sectionIndex) {
    if (typeof HarmonicContext === 'undefined' || !HarmonicContext || typeof HarmonicContext.set !== 'function') {
      throw new Error('HarmonicJourney.applyL2ToContext: HarmonicContext not available');
    }

    const comp = getL2Complement(sectionIndex);
    const resolved = HJ.resolveScaleAndQuality(comp.key, comp.mode);

    HarmonicContext.set({
      key: comp.key,
      mode: comp.mode,
      quality: resolved.quality,
      scale: resolved.scaleNotes
    });
  }

  /**
   * Get the full planned journey.
   * @returns {JourneyStop[]}
   */
  function getPlan() {
    return plan.slice();
  }

  /**
   * Get current stop index.
   * @returns {number}
   */
  function getCurrentIndex() {
    return currentStopIndex;
  }

  /**
   * Get origin key/mode.
   * @returns {{ key: string, mode: string }}
   */
  function getOrigin() {
    return { key: originKey, mode: originMode };
  }

  /**
   * Reset journey state.
   */
  function reset() {
    plan = [];
    originKey = 'C';
    originMode = 'major';
    currentStopIndex = 0;
  }

  return {
    planJourney,
    getStop,
    applyToContext,
    getL2Complement,
    applyL2ToContext,
    getPlan,
    getCurrentIndex,
    getOrigin,
    reset
  };
})();
