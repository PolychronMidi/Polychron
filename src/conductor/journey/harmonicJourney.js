// harmonicJourney.js - Tonal center trajectory engine for cross-section/cross-layer coherence.
//
// Plans a key/mode journey across sections using music-theory relationships
// (circle of fifths, relative major/minor, parallel modes, chromatic mediants).
// Drives harmonicContext at section/phrase boundaries so every downstream consumer
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

harmonicJourney = (() => {
  const V = validator.create('harmonicJourney');

  V.requireType(harmonicJourneyHelpers, 'function', 'harmonicJourneyHelpers');
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
      throw new Error('harmonicJourney.planJourney: totalSections must be a positive integer');
    }
    if (!t || !t.Note || !t.Key) {
      throw new Error('harmonicJourney.planJourney: Tonal.js (t) not available');
    }

    const { startKey, startMode } = harmonicJourneyPlanner.resolveStart(opts);
    originKey = startKey;
    originMode = startMode;
    plan = [{ key: startKey, mode: startMode, move: 'origin', distance: 0 }];

    const steps = harmonicJourneyPlanner.buildSteps(totalSections, originKey, originMode, HJ);
    plan.push(...steps);

    currentStopIndex = 0;
    return plan.slice();
  }

  /**
   * Gets the journey stop for a given section index.
   * @param {number} sectionIndex
   * @returns {JourneyStop}
   */
  function getStop(sectionIndex) {
    if (plan.length === 0) throw new Error('harmonicJourney.getStop: journey not planned yet');
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
      throw new Error('harmonicJourney.getStop: sectionIndex must be a non-negative integer');
    }
    const idx = m.min(sectionIndex, plan.length - 1);
    return plan[idx];
  }

  /**
   * Apply the journey stop for the current section to harmonicContext.
   * Called at each section boundary in main.js.
   * @param {number} sectionIndex
   */
  function applyToContext(sectionIndex) {
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

    harmonicContext.set({
      key: stop.key,
      mode: stop.mode,
      quality: resolved.quality,
      scale: resolved.scaleNotes,
      excursion: excursion,
      sectionPhase: currentPhase
    });

    // Xenolinguistic: spectral awareness influences harmonic context.
    // If low registers dominate, post brightness hint for downstream modules.
    const spectralEntry = L0.getLast(L0_CHANNELS.spectral, { layer: 'both' });
    const spectralBrightness = spectralEntry && Array.isArray(spectralEntry.histogram)
      ? (spectralEntry.histogram[2] + spectralEntry.histogram[3]) / m.max(1, spectralEntry.histogram.reduce((a, b) => a + b, 0))
      : 0.5;
    L0.post(L0_CHANNELS.harmonic, 'both', beatStartTime, {
      key: stop.key, mode: stop.mode, excursion, sectionPhase: currentPhase,
      move: stop.move, distance: stop.distance, spectralBrightness
    });

    // R37: harmonic journey self-assessment -- evaluate previous section's move effectiveness
    if (sectionIndex > 0) {
      const prevMem = sectionMemory.getPrevious();
      const prevStop = getStop(sectionIndex - 1);
      if (prevMem) {
        L0.post(L0_CHANNELS.harmonicJourneyEval, 'both', beatStartTime, {
          fromKey: prevStop.key, toKey: stop.key, move: stop.move,
          distance: stop.distance, excursion,
          quality: V.optionalFinite(prevMem.quality, 0.5),
          regime: prevMem.regime || 'evolving',
          effective: (V.optionalFinite(prevMem.quality, 0.5)) > 0.6
        });
      }
    }

    // Emit journey-move event for rhythm-harmonic coupling
    {
      const EVENTS = V.getEventsOrThrow();
      eventBus.emit(EVENTS.JOURNEY_MOVE, {
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

    // Normalize key - simplify strips double-sharps/flats (C## - D, B# - C)
    const simplified = t.Note.simplify(result.key);
    const normalized = t.Note.pitchClass(simplified || result.key);
    if (!normalized) {
      throw new Error(`harmonicJourney.getL2Complement: relationship produced invalid key "${result.key}"`);
    }

    return { key: normalized, mode: result.mode, relationship: result.relationship };
  }

  /**
   * Apply L2 complement to harmonicContext (called when L2 activates).
   * @param {number} sectionIndex
   */
  function applyL2ToContext(sectionIndex) {
    const comp = getL2Complement(sectionIndex);
    const resolved = HJ.resolveScaleAndQuality(comp.key, comp.mode);

    harmonicContext.set({
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
