// src/conductor/pedalPointDetector.js - Sustained/repeated bass note detection.
// Detects harmonic anchoring from bass pedal points (MIDI <= 55).
// Stateless - queries ATW per call; returns dominant bass PC and staleness.
//
// Complementary to harmonicPedalFieldTracker (harmonic/) which is stateful and
// tracks bass PC streak duration for derivedTension bias. This detector feeds
// pedalSuggestion for compositional guidance (move-bass / pedal-effective / anchor).
// Both are consumed by globalConductor for different product chains.

pedalPointDetector = (() => {
  const V = validator.create('pedalPointDetector');
  const WINDOW_SECONDS = 6;
  const BASS_CEILING = 55; // MIDI note - below this = bass register

  /**
   * Detect pedal points (repeated/sustained bass notes) in the ATW window.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ pedalNote: number|null, pedalCount: number, pedalDuration: number, active: boolean, stale: boolean }}
   */
  function getPedalProfile(opts = {}) {
    const safeOpts = opts && typeof opts === 'object' ? opts : {};
    const ws = V.optionalFinite(safeOpts.windowSeconds, WINDOW_SECONDS);
    const notes = analysisHelpers.getWindowNotes(V, safeOpts, WINDOW_SECONDS);
    const noteMidis = analysisHelpers.extractMidiArray(notes, 60);

    // Filter to bass register
    const bassNotes = [];
    for (let i = 0; i < notes.length; i++) {
      const midi = noteMidis[i];
      if (midi <= BASS_CEILING) {
        bassNotes.push(notes[i]);
      }
    }

    if (bassNotes.length < 3) {
      return { pedalNote: null, pedalCount: 0, pedalDuration: 0, active: false, stale: false };
    }

    // Count repetitions of each bass pitch class
    const pcCounts = /** @type {Object.<number, number>} */ ({});
    const bassPcs = analysisHelpers.extractPCArray(analysisHelpers.extractMidiArray(bassNotes, 0), 0);
    for (let i = 0; i < bassPcs.length; i++) {
      const pc = bassPcs[i];
      pcCounts[pc] = (V.optionalFinite(pcCounts[pc], 0)) + 1;
    }

    // Find the most repeated pitch class
    let maxPC = 0;
    let maxCount = 0;
    const keys = Object.keys(pcCounts);
    for (let i = 0; i < keys.length; i++) {
      const pc = Number(keys[i]);
      const count = pcCounts[pc];
      if (typeof count === 'number' && count > maxCount) {
        maxCount = count;
        maxPC = pc;
      }
    }

    // Pedal is active if dominant bass note appears in >60% of bass notes
    const active = maxCount / bassNotes.length > 0.6;

    // Estimate duration of pedal
    let pedalDuration = 0;
    if (active && bassNotes.length >= 2) {
      const first = bassNotes[0];
      const last = bassNotes[bassNotes.length - 1];
      pedalDuration = last.time - first.time;
    }

    // Stale if pedal has been held for too long (>75% of window)
    const stale = active && pedalDuration > ws * 0.75;

    return {
      pedalNote: active ? maxPC : null,
      pedalCount: maxCount,
      pedalDuration,
      active,
      stale
    };
  }

  /**
   * Get a bass movement suggestion.
   * Stale pedal - encourage bass movement; no pedal - suggest anchoring.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ suggestion: string, urgency: number }}
   */
  function getBassSuggestion(opts) {
    const profile = getPedalProfile(opts);
    if (profile.stale) {
      return { suggestion: 'move-bass', urgency: 0.7 };
    }
    if (profile.active) {
      return { suggestion: 'pedal-effective', urgency: 0 };
    }
    return { suggestion: 'consider-anchor', urgency: 0.2 };
  }

  conductorIntelligence.registerStateProvider('pedalPointDetector', () => {
    const s = pedalPointDetector.getBassSuggestion();
    return {
      pedalSuggestion: s ? s.suggestion : 'consider-anchor',
      pedalUrgency: s ? s.urgency : 0
    };
  });

  return {
    getPedalProfile,
    getBassSuggestion
  };
})();
