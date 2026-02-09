// src/composers/HarmonicContext.js - Shared harmonic state for composer coherence
// Enables harmonically-aware composition across multiple composer types

HarmonicContext = (() => {
  let state = {
    key: 'C',           // Root note
    mode: 'major',      // Primary mode/scale mode
    quality: 'major',   // Triad quality (major, minor, diminished, etc.)
    scale: [],          // Pitch class set (MIDI note numbers modulo 12)
    chords: [],         // Active harmonic set (chord symbols or note arrays)
    modifiedAt: 0       // Timestamp of last update
  };

  /**
   * Set harmonic context state
   * @param {Object} updates - Partial state update { key?, mode?, quality?, scale?, chords? }
   * @throws {Error} if updates invalid or required fields missing
   */
  function set(updates) {
    if (!updates || typeof updates !== 'object') {
      throw new Error('HarmonicContext.set: updates must be an object');
    }

    const { key, mode, quality, scale, chords } = updates;

    if (key !== undefined) {
      if (typeof key !== 'string' || !key) throw new Error('HarmonicContext.set: key must be non-empty string');
      state.key = key;
    }

    if (mode !== undefined) {
      if (typeof mode !== 'string' || !mode) throw new Error('HarmonicContext.set: mode must be non-empty string');
      state.mode = mode;
    }

    if (quality !== undefined) {
      if (typeof quality !== 'string' || !quality) throw new Error('HarmonicContext.set: quality must be non-empty string');
      state.quality = quality;
    }

    if (scale !== undefined) {
      if (!Array.isArray(scale) || scale.length === 0) throw new Error('HarmonicContext.set: scale must be non-empty array');
      state.scale = scale;
    }

    if (chords !== undefined) {
      if (!Array.isArray(chords)) throw new Error('HarmonicContext.set: chords must be an array');
      state.chords = chords;
    }

    state.modifiedAt = Date.now();
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
    if (!state.hasOwnProperty(field)) {
      throw new Error(`HarmonicContext.getField: unknown field "${field}"`);
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
    if (typeof t === 'undefined' || !t.Scale) {
      throw new Error('HarmonicContext.updateScaleFromMode: Tonal.js not available');
    }

    const scaleName = `${key} ${mode}`;
    try {
      const scaleNotes = t.Scale.get(scaleName).notes;
      if (!Array.isArray(scaleNotes) || scaleNotes.length === 0) {
        throw new Error(`scale "${scaleName}" returned empty notes`);
      }
      state.scale = scaleNotes;
      state.key = key;
      state.mode = mode;
      state.modifiedAt = Date.now();
    } catch (e) {
      throw new Error(`HarmonicContext.updateScaleFromMode: failed to generate scale "${scaleName}": ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * Check if note is in current scale
   * @param {string|number} note - note name or MIDI number
   * @returns {boolean}
   */
  function isNoteInScale(note) {
    const chroma = typeof note === 'number' ? note % 12 : (typeof t !== 'undefined' && t.Note) ? t.Note.chroma(note) : -1;
    if (typeof chroma !== 'number' || chroma < 0) return false;
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
