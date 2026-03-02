// src/composers/harmonicContext.js - Shared harmonic state for composer coherence
// Enables harmonically-aware composition across multiple composer types

/**
 * @typedef {Object} HarmonicState
 * @property {string} key
 * @property {string} mode
 * @property {string} quality
 * @property {(string|number)[]} scale
 * @property {Array<*>} chords
 * @property {number} tension
 * @property {number} excursion
 * @property {string} sectionPhase
 * @property {number} mutationCount
 * @property {number} modifiedAt
 */
harmonicContext = (() => {
  const V = validator.create('harmonicContext');

  /** @type {HarmonicState} */
  let state = {
    key: 'C',           // Root note
    mode: 'major',      // Primary mode/scale mode
    quality: 'major',   // Triad quality (major, minor, diminished, etc.)
    scale: /** @type {(string|number)[]} */ ([]),          // Pitch class set (MIDI note numbers modulo 12)
    chords: /** @type {Array<*>} */ ([]),         // Active harmonic set (chord symbols or note arrays)
    tension: 0,         // Harmonic tension (0-1)
    excursion: 0,       // Harmonic distance from home key (0-6)
    sectionPhase: 'development', // Structural phase (opening, development, climax, resolution)
    mutationCount: 0,   // Count of harmonic mutations for rhythm-rate tracking
    modifiedAt: 0       // Timestamp of last update
  };

  /**
   * Set harmonic context state
   * @param {Object} updates - Partial state update { key?, mode?, quality?, scale?, chords? }
   * @throws {Error} if updates invalid or required fields missing
   */
  function set(updates) {
    V.assertObject(updates, 'updates');

    const { key, mode, quality, scale, chords, tension, excursion, sectionPhase } = updates;
    const changedFields = [];

    if (key !== undefined) {
      V.requireType(key, 'string', 'key');
      if (!key) throw new Error('harmonicContext.set: key must be non-empty string');
      if (state.key !== key) changedFields.push('key');
      state.key = key;
    }

    if (mode !== undefined) {
      V.requireType(mode, 'string', 'mode');
      if (!mode) throw new Error('harmonicContext.set: mode must be non-empty string');
      if (state.mode !== mode) changedFields.push('mode');
      state.mode = mode;
    }

    if (quality !== undefined) {
      V.requireType(quality, 'string', 'quality');
      if (!quality) throw new Error('harmonicContext.set: quality must be non-empty string');
      if (state.quality !== quality) changedFields.push('quality');
      state.quality = quality;
    }

    if (scale !== undefined) {
      V.assertArray(scale, 'scale', true);
      if (JSON.stringify(state.scale) !== JSON.stringify(scale)) changedFields.push('scale');
      state.scale = scale;
    }

    if (chords !== undefined) {
      V.assertArray(chords, 'chords');
      if (JSON.stringify(state.chords) !== JSON.stringify(chords)) changedFields.push('chords');
      state.chords = chords;
    }

    if (tension !== undefined) {
      const t = Number(tension);
      V.requireFinite(t, 'tension');
      if (t < 0 || t > 1) throw new Error('harmonicContext.set: tension must be number 0-1');
      if (state.tension !== t) changedFields.push('tension');
      state.tension = t;
    }

    if (excursion !== undefined) {
      const e = Number(excursion);
      V.requireFinite(e, 'excursion');
      if (e < 0) throw new Error('harmonicContext.set: excursion must be non-negative number');
      if (state.excursion !== e) changedFields.push('excursion');
      state.excursion = e;
    }

    if (sectionPhase !== undefined) {
      V.requireType(sectionPhase, 'string', 'sectionPhase');
      if (!sectionPhase) throw new Error('harmonicContext.set: sectionPhase must be non-empty string');
      if (state.sectionPhase !== sectionPhase) changedFields.push('sectionPhase');
      state.sectionPhase = sectionPhase;
    }

    if (changedFields.length > 0) {
      state.mutationCount += 1;
    }
    state.modifiedAt = Date.now();

    if (changedFields.length > 0) {
      const EVENTS = V.getEventsOrThrow();
      eventBus.emit(EVENTS.HARMONIC_CHANGE, {
        changedFields,
        key: state.key,
        mode: state.mode,
        quality: state.quality,
        scale: state.scale,
        chords: state.chords,
        sectionPhase: state.sectionPhase,
        excursion: state.excursion,
        tension: state.tension,
        mutationCount: state.mutationCount,
        tick: V.requireFinite(beatStart, 'beatStart'),
        timestamp: state.modifiedAt
      });
    }

  }

  /**
   * Get full harmonic context state
   * @returns {Object} current state copy
   */
  function get() {
    return Object.assign({}, state);
  }

  /**
   * Get specific field from context
   * @param {string} field - field name (key, mode, quality, scale, chords)
   * @returns {*} field value
   * @throws {Error} if field unknown
   */
  function getField(field) {
    const snapshot = conductorState.getSnapshot();
    if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, field)) {
      return snapshot[field];
    }

    if (!Object.prototype.hasOwnProperty.call(state, field)) {
      throw new Error(`harmonicContext.getField: unknown field "${field}"`);
    }
    return state[field];
  }

  /**
   * Update scale from mode/key via Tonal.js
   * Fails-fast if scale can't be generated
   * @param {string} key - root note (e.g., 'C')
   * @param {string} mode - mode name (e.g., 'major', 'dorian')
   * @throws {Error} if key/mode invalid or Tonal unavailable
   */
  function updateScaleFromMode(key, mode) {
    if (!t || !t.Scale) {
      throw new Error('harmonicContext.updateScaleFromMode: Tonal.js not available');
    }

    const scaleName = `${key} ${mode}`;
    try {
      const scaleNotes = t.Scale.get(scaleName).notes;
      V.assertArray(scaleNotes, 'scaleNotes', true);
      state.scale = scaleNotes;
      state.key = key;
      state.mode = mode;
    } catch (e) {
      throw new Error(`harmonicContext.updateScaleFromMode: failed to generate scale "${scaleName}": ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * Check if note is in current scale
   * @param {string|number} noteInput - note name or MIDI number
   * @returns {boolean}
   */
  function isNoteInScale(noteInput) {
    const chroma = typeof noteInput === 'number' ? noteInput % 12 : (t && t.Note) ? t.Note.chroma(noteInput) : -1;
    if (!Number.isFinite(chroma) || chroma < 0) return false;
    return state.scale.some(n => (typeof n === 'number' ? n : (t && t.Note) ? t.Note.chroma(n) : -1) === chroma);
  }

  /**
   * Reset context to defaults
   */
  function reset() {
    state = {
      key: 'C',
      mode: 'major',
      quality: 'major',
      scale: [],
      chords: [],
      tension: 0,
      excursion: 0,
      sectionPhase: 'development',
      mutationCount: 0,
      modifiedAt: 0
    };
  }

  /**
   * Get JSON serialization (for logging/debugging)
   * @returns {Object}
   */
  function toJSON() {
    return get();
  }

  return {
    set,
    get,
    getField,
    updateScaleFromMode,
    isNoteInScale,
    reset,
    toJSON
  };
})();
