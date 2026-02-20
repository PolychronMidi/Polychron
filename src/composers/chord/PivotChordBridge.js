// src/composers/chord/PivotChordBridge.js - Pivot chord modulation bridge between harmonic journey stops
// Finds shared diatonic chords between two keys and generates smooth transitional progressions

PivotChordBridge = (() => {
  /** @type {string[]|null} */
  let _pendingBridge = null;

  /**
   * Map mode names to major/minor quality for Tonal.js Key API
   */
  const MODE_TO_QUALITY = {
    ionian: 'major', dorian: 'minor', phrygian: 'minor', lydian: 'major',
    mixolydian: 'major', aeolian: 'minor', locrian: 'minor', major: 'major', minor: 'minor'
  };

  /**
   * Pivot chord ranking by scale degree in the TARGET key.
   * ii (1) best — sets up V; IV (3) subdominant; vi (5) relative; I (0) tonic.
   * Higher rank = better pivot for establishing the new key.
   */
  const PIVOT_RANK = { 1: 5, 3: 4, 5: 3, 0: 2, 2: 1, 4: 0, 6: 0 };

  /**
   * Get diatonic chords for a key/mode via Tonal.js Key API
   * @param {string} key - pitch class (e.g., 'C', 'F#')
   * @param {string} mode - mode name (e.g., 'major', 'dorian')
   * @returns {string[]} 7 diatonic chord symbols
   */
  const getDiatonicChords = (key, mode) => {
    const qual = MODE_TO_QUALITY[mode] || 'major';
    const keyApi = qual === 'minor' ? t.Key.minorKey : t.Key.majorKey;
    const keyData = keyApi(key);
    return qual === 'minor' ? keyData.natural.chords : keyData.chords;
  };

  /**
   * Normalize a Tonal chord string to root pitch class + basic quality for comparison.
   * Strips extensions (7ths, 9ths) so 'Cmaj7' and 'C' both become { root: 'C', quality: 'Major' }.
   * @param {string} chordStr
   * @returns {{ root: string, quality: string }|null}
   */
  const normalizeTriad = (chordStr) => {
    const parsed = t.Chord.get(chordStr);
    if (parsed.empty) return null;
    return { root: parsed.tonic, quality: parsed.quality };
  };

  /**
   * Find pivot chords shared between two keys (chords whose root and triad quality match).
   * Results sorted by musical usefulness as a modulation pivot in the TARGET key.
   * @param {string} fromKey
   * @param {string} fromMode
   * @param {string} toKey
   * @param {string} toMode
   * @returns {Array<{ chord: string, fromDegree: number, toDegree: number, rank: number }>}
   */
  function findPivotChords(fromKey, fromMode, toKey, toMode) {
    if (!fromKey || !toKey) throw new Error('PivotChordBridge.findPivotChords: keys required');

    const fromChords = getDiatonicChords(fromKey, fromMode);
    const toChords = getDiatonicChords(toKey, toMode);

    if (!Array.isArray(fromChords) || fromChords.length < 7) {
      throw new Error(`PivotChordBridge.findPivotChords: insufficient diatonic chords for ${fromKey} ${fromMode}`);
    }
    if (!Array.isArray(toChords) || toChords.length < 7) {
      throw new Error(`PivotChordBridge.findPivotChords: insufficient diatonic chords for ${toKey} ${toMode}`);
    }

    const pivots = [];

    for (let fi = 0; fi < fromChords.length; fi++) {
      const fromNorm = normalizeTriad(fromChords[fi]);
      if (!fromNorm) continue;

      for (let ti = 0; ti < toChords.length; ti++) {
        const toNorm = normalizeTriad(toChords[ti]);
        if (!toNorm) continue;

        // Match by pitch class and triad quality
        if (t.Note.chroma(fromNorm.root) === t.Note.chroma(toNorm.root) && fromNorm.quality === toNorm.quality) {
          pivots.push({
            chord: fromChords[fi],
            fromDegree: fi,
            toDegree: ti,
            rank: PIVOT_RANK[ti] || 0
          });
        }
      }
    }

    // Best pivots first
    pivots.sort((a, b) => b.rank - a.rank);
    return pivots;
  }

  /**
   * Generate a bridge progression that modulates from one key/mode to another.
   * Uses pivot chords when available (closely related keys), dominant approach otherwise.
   *
   * With pivot:   [outgoing I] → [pivot chord] → [target V] → [target I]
   * Without pivot: [outgoing I] → [outgoing IV] → [target V] → [target I]
   *
   * @param {string} fromKey
   * @param {string} fromMode
   * @param {string} toKey
   * @param {string} toMode
   * @returns {string[]} Array of chord symbols (empty if same key/mode)
   */
  function generateBridge(fromKey, fromMode, toKey, toMode) {
    // Same key and mode — no bridge needed
    if (t.Note.chroma(fromKey) === t.Note.chroma(toKey) && fromMode === toMode) {
      return [];
    }

    const fromChords = getDiatonicChords(fromKey, fromMode);
    const toChords = getDiatonicChords(toKey, toMode);

    if (!Array.isArray(fromChords) || fromChords.length < 7 || !Array.isArray(toChords) || toChords.length < 7) {
      return []; // Fail gracefully for edge-case modes
    }

    const pivots = findPivotChords(fromKey, fromMode, toKey, toMode);

    // Target key cadential chords
    const targetV = toChords[4];
    const targetI = toChords[0];
    const outgoingI = fromChords[0];

    if (pivots.length > 0) {
      // PIVOT MODULATION
      const pivot = pivots[0];
      const bridge = [outgoingI, pivot.chord, targetV, targetI];

      // For ii pivots (strongest), optionally add pre-pivot IV for richer approach
      // I → IV → pivot(ii) → V → I
      if (pivot.toDegree === 1 && fromChords[3] && rf() < 0.5) {
        bridge.splice(1, 0, fromChords[3]);
      }

      return bridge;
    }

    // NO SHARED PIVOTS (chromatic distance ≥ 5) — dominant approach
    // [outgoing I] → [outgoing IV] → [target V] → [target I]
    return [outgoingI, fromChords[3], targetV, targetI];
  }

  /**
   * Prepare a bridge for the given section using HarmonicJourney's plan.
   * Called at each section boundary in main.js.
   * @param {number} sectionIndex
   */
  function prepareBridge(sectionIndex) {
    _pendingBridge = null;

    if (sectionIndex <= 0) return; // No bridge for the first section

    const currentStop = HarmonicJourney.getStop(sectionIndex);
    const previousStop = HarmonicJourney.getStop(sectionIndex - 1);

    // Only bridge when there's an actual key or mode change
    const keyChanged = t.Note.chroma(currentStop.key) !== t.Note.chroma(previousStop.key) || currentStop.mode !== previousStop.mode;
    if (keyChanged) {
      const bridge = generateBridge(previousStop.key, previousStop.mode, currentStop.key, currentStop.mode);
      if (bridge.length > 0) {
        _pendingBridge = bridge;
      }
    }
  }

  /**
   * Check if a bridge progression is pending.
   * @returns {boolean}
   */
  function hasBridge() {
    return _pendingBridge !== null && _pendingBridge.length > 0;
  }

  /**
   * Consume and return the pending bridge (one-shot: clears after returning).
   * The first chord-based composer created after a section boundary gets the bridge.
   * @returns {string[]|null}
   */
  function consumeBridge() {
    const bridge = _pendingBridge;
    _pendingBridge = null;
    return bridge;
  }

  /**
   * Reset state.
   */
  function reset() {
    _pendingBridge = null;
  }

  return {
    findPivotChords,
    generateBridge,
    prepareBridge,
    hasBridge,
    consumeBridge,
    reset
  };
})();
