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

/**
 * Movement strategies — pure music theory relationships.
 * Each returns { key, mode, move } given a current key and mode.
 * Strategies are grouped by "boldness" so arc phases can pick appropriately.
 */
const CLOSE_MOVES = [
  // Circle of fifths up (dominant direction)
  (key, mode) => ({ key: t.Note.transpose(key, 'P5'), mode, move: 'fifth-up' }),
  // Circle of fifths down (subdominant direction)
  (key, mode) => ({ key: t.Note.transpose(key, 'P4'), mode, move: 'fourth-up' }),
  // Relative major/minor
  (key, mode) => {
    if (mode === 'major' || mode === 'ionian') {
      return { key: t.Note.transpose(key, 'm3').replace(/\d+$/, ''), mode: 'minor', move: 'relative-minor' };
    }
    return { key: t.Note.transpose(key, 'M3').replace(/\d+$/, ''), mode: 'major', move: 'relative-major' };
  },
];

const MODERATE_MOVES = [
  // Parallel mode shift (same root, different mode)
  (key, mode) => {
    const parallelModes = {
      major: ['dorian', 'mixolydian', 'lydian'],
      minor: ['dorian', 'phrygian', 'aeolian'],
      dorian: ['major', 'minor', 'mixolydian'],
      mixolydian: ['major', 'dorian', 'lydian'],
      lydian: ['major', 'mixolydian', 'ionian'],
      phrygian: ['minor', 'dorian', 'aeolian'],
      aeolian: ['minor', 'dorian', 'phrygian'],
      locrian: ['minor', 'phrygian', 'aeolian'],
      ionian: ['dorian', 'mixolydian', 'lydian'],
    };
    const options = parallelModes[mode] || ['major', 'minor'];
    const newMode = options[ri(options.length - 1)];
    return { key, mode: newMode, move: `parallel-${newMode}` };
  },
  // Whole step up
  (key, mode) => ({ key: t.Note.transpose(key, 'M2'), mode, move: 'step-up' }),
  // Whole step down
  (key, mode) => ({ key: t.Note.transpose(key, 'M2').replace(/\d+$/, ''), mode, move: 'step-down' }),
];

const BOLD_MOVES = [
  // Chromatic mediant (major third up, keep quality)
  (key, mode) => ({ key: t.Note.transpose(key, 'M3'), mode, move: 'chromatic-mediant-up' }),
  // Chromatic mediant (major third down)
  (key, mode) => ({ key: t.Note.transpose(key, 'm3'), mode, move: 'chromatic-mediant-down' }),
  // Tritone substitution
  (key, mode) => ({ key: t.Note.transpose(key, 'A4'), mode, move: 'tritone-sub' }),
  // Minor third up with mode flip
  (key, mode) => {
    const flipped = (mode === 'major' || mode === 'ionian' || mode === 'lydian' || mode === 'mixolydian') ? 'minor' : 'major';
    return { key: t.Note.transpose(key, 'm3'), mode: flipped, move: 'mediant-flip' };
  },
];

/**
 * Computes semitone distance between two pitch classes.
 * @param {string} from - Pitch class
 * @param {string} to   - Pitch class
 * @returns {number} Distance in semitones (0-11)
 */
const chromaticDistance = (from, to) => {
  const a = t.Note.chroma(from);
  const b = t.Note.chroma(to);
  if (typeof a !== 'number' || typeof b !== 'number' || a < 0 || b < 0) return 0;
  return ((b - a) + 12) % 12;
};

/**
 * Resolves arc phase name for a section position.
 * @param {number} sectionIndex
 * @param {number} totalSections
 * @returns {'opening'|'development'|'climax'|'resolution'}
 */
const getSectionPhase = (sectionIndex, totalSections) => {
  if (totalSections <= 0) return 'development';
  const pos = sectionIndex / totalSections;
  if (pos < 0.2) return 'opening';
  if (pos < 0.55) return 'development';
  if (pos < 0.8) return 'climax';
  return 'resolution';
};

/**
 * Selects a move pool based on the structural phase.
 * Opening/resolution = close moves; development = moderate; climax = bold.
 * @param {'opening'|'development'|'climax'|'resolution'} phase
 * @returns {Function[]}
 */
const getMovePoolForPhase = (phase) => {
  switch (phase) {
    case 'opening':    return CLOSE_MOVES;
    case 'resolution': return [...CLOSE_MOVES, ...MODERATE_MOVES.slice(0, 1)];
    case 'development': return [...CLOSE_MOVES, ...MODERATE_MOVES];
    case 'climax':     return [...MODERATE_MOVES, ...BOLD_MOVES];
    default:           return CLOSE_MOVES;
  }
};

/**
 * L2 relationship strategies — how L2 relates to L1's current key.
 * Returns { key, mode, relationship }.
 */
const L2_RELATIONSHIPS = [
  // Same key, same mode (unison)
  (key, mode) => ({ key, mode, relationship: 'unison' }),
  // Same key, parallel mode
  (key, mode) => {
    const alt = (mode === 'major' || mode === 'ionian') ? 'minor' : 'major';
    return { key, mode: alt, relationship: 'parallel' };
  },
  // Relative key
  (key, mode) => {
    if (mode === 'major' || mode === 'ionian') {
      return { key: t.Note.transpose(key, 'm3'), mode: 'minor', relationship: 'relative' };
    }
    return { key: t.Note.transpose(key, 'M3'), mode: 'major', relationship: 'relative' };
  },
  // Dominant key (fifth up)
  (key, mode) => ({ key: t.Note.transpose(key, 'P5'), mode, relationship: 'dominant' }),
  // Subdominant key (fourth up)
  (key, mode) => ({ key: t.Note.transpose(key, 'P4'), mode, relationship: 'subdominant' }),
];

HarmonicJourney = (() => {
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
      const phase = getSectionPhase(s, totalSections);
      const movePool = getMovePoolForPhase(phase);

      // Resolution sections bias toward returning home
      if (phase === 'resolution' && rf() < 0.5) {
        const dist = chromaticDistance(currentKey, originKey);
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
      let nextKey = t.Note.pitchClass(result.key);
      if (!nextKey) {
        // Fallback: stay put
        plan.push({ key: currentKey, mode: currentMode, move: 'hold', distance: 0 });
        continue;
      }

      const dist = chromaticDistance(currentKey, nextKey);
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
    const scaleName = `${stop.key} ${stop.mode}`;
    const scaleData = t.Scale.get(scaleName);
    const scaleNotes = (scaleData && Array.isArray(scaleData.notes) && scaleData.notes.length > 0)
      ? scaleData.notes
      : t.Scale.get(`${stop.key} major`).notes;

    // Derive quality from mode
    const modeToQuality = {
      major: 'major', ionian: 'major', lydian: 'major', mixolydian: 'major',
      minor: 'minor', aeolian: 'minor', dorian: 'minor', phrygian: 'minor', locrian: 'minor'
    };
    const quality = modeToQuality[stop.mode] || 'major';

    HarmonicContext.set({
      key: stop.key,
      mode: stop.mode,
      quality: quality,
      scale: scaleNotes
    });
  }

  /**
   * Compute a complementary key/mode for L2 based on L1's current stop.
   * @param {number} sectionIndex
   * @returns {{ key: string, mode: string, relationship: string }}
   */
  function getL2Complement(sectionIndex) {
    const l1Stop = getStop(sectionIndex);
    const relFn = L2_RELATIONSHIPS[ri(L2_RELATIONSHIPS.length - 1)];
    const result = relFn(l1Stop.key, l1Stop.mode);

    // Normalize key
    const normalized = t.Note.pitchClass(result.key);
    if (!normalized) {
      return { key: l1Stop.key, mode: l1Stop.mode, relationship: 'fallback-unison' };
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
    const scaleName = `${comp.key} ${comp.mode}`;
    const scaleData = t.Scale.get(scaleName);
    const scaleNotes = (scaleData && Array.isArray(scaleData.notes) && scaleData.notes.length > 0)
      ? scaleData.notes
      : t.Scale.get(`${comp.key} major`).notes;

    const modeToQuality = {
      major: 'major', ionian: 'major', lydian: 'major', mixolydian: 'major',
      minor: 'minor', aeolian: 'minor', dorian: 'minor', phrygian: 'minor', locrian: 'minor'
    };
    const quality = modeToQuality[comp.mode] || 'major';

    HarmonicContext.set({
      key: comp.key,
      mode: comp.mode,
      quality: quality,
      scale: scaleNotes
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
