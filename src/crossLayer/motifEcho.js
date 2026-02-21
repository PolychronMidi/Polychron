// src/crossLayer/motifEcho.js — Cross-layer motif echo / imitative counterpoint.
// When playMotifs generates a motif in L1, stores its interval sequence.
// After a delay (1-4 beats in L2's time), injects a transformed echo
// (retrograde, inversion, augmentation) into L2's motif pool.
// Creates fugue-like imitative counterpoint across polyrhythmic layers.

MotifEcho = (() => {
  const V = Validator.create('MotifEcho');
  const CHANNEL = 'motifEcho';
  const ECHO_DELAY_BEATS_MIN = 1;
  const ECHO_DELAY_BEATS_MAX = 4;
  const MAX_PENDING_ECHOES = 8;
  const ECHO_PROBABILITY = 0.35;

  /** @type {Array<{ intervals: number[], originLayer: string, captureMs: number, deliverMs: number, transform: string }>} */
  const pendingEchoes = [];

  /** @type {Map<string, number[]>} last few notes per layer to extract intervals */
  const recentNotes = new Map();
  const RECENT_WINDOW = 6;

  /**
   * Record a note to build interval sequences.
   * @param {number} midi - MIDI note
   * @param {string} layer - source layer
   * @param {number} absTimeMs - absolute ms
   */
  function recordNote(midi, layer, absTimeMs) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absTimeMs, 'absTimeMs');
    if (!recentNotes.has(layer)) recentNotes.set(layer, []);
    const notes = recentNotes.get(layer);
    if (!notes) throw new Error('MotifEcho.recordNote: missing recent notes for layer ' + layer);
    notes.push(midi);
    if (notes.length > RECENT_WINDOW) notes.shift();

    // When we accumulate enough notes, potentially capture a motif fragment
    if (notes.length >= 3 && rf() < ECHO_PROBABILITY && pendingEchoes.length < MAX_PENDING_ECHOES) {
      captureMotif(layer, absTimeMs);
    }
  }

  /**
   * Capture current interval sequence and schedule echo for the other layer.
   * @param {string} layer
   * @param {number} absTimeMs
   */
  function captureMotif(layer, absTimeMs) {
    const notes = recentNotes.get(layer);
    if (!notes || notes.length < 3) return;

    // Extract interval sequence (relative intervals between consecutive notes)
    const intervals = [];
    for (let i = 1; i < notes.length; i++) {
      intervals.push(notes[i] - notes[i - 1]);
    }

    // Pick transform type
    const transforms = ['retrograde', 'inversion', 'augmentation', 'retrograde-inversion'];
    let transform = transforms[ri(transforms.length - 1)];
    const identityChoice = MotifIdentityMemory.chooseEchoTransform(layer);
    if (identityChoice && typeof identityChoice.transform === 'string' && rf() < clamp(identityChoice.bias, 0, 1)) {
      transform = identityChoice.transform;
    }

    // Schedule delivery after a random delay in beats
    const delayBeats = ri(ECHO_DELAY_BEATS_MIN, ECHO_DELAY_BEATS_MAX);
    const beatDurationMs = tpBeat > 0 ? (tpBeat / tpSec) * 1000 : 500;
    const deliverMs = absTimeMs + delayBeats * beatDurationMs;

    pendingEchoes.push({
      intervals,
      originLayer: layer,
      captureMs: absTimeMs,
      deliverMs,
      transform
    });

    // Post to ATG for visibility
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
      intervals,
      transform,
      delayBeats
    });
  }

  /**
   * Transform an interval sequence.
   * @param {number[]} intervals
   * @param {string} transform
   * @returns {number[]} transformed intervals
   */
  function applyTransform(intervals, transform) {
    switch (transform) {
      case 'retrograde':
        return [...intervals].reverse();
      case 'inversion':
        return intervals.map(i => -i);
      case 'augmentation':
        return intervals.map(i => Math.round(i * 1.5));
      case 'retrograde-inversion':
        return [...intervals].reverse().map(i => -i);
      default:
        return intervals;
    }
  }

  /**
   * Check for pending echoes ready to deliver to the active layer.
   * Returns transformed note offsets that can bias the next motif selection.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - receiving layer
   * @param {number} currentMidi - the note currently being placed (as anchor)
   * @returns {{ notes: number[], transform: string, echoIndex: number } | null}
   */
  function deliverEcho(absTimeMs, activeLayer, currentMidi) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.requireFinite(currentMidi, 'currentMidi');

    // Find the first pending echo whose delivery time has passed and targets this layer
    for (let i = 0; i < pendingEchoes.length; i++) {
      const echo = pendingEchoes[i];
      const targetLayer = echo.originLayer === 'L1' ? 'L2' : 'L1';
      if (targetLayer !== activeLayer) continue;
      if (absTimeMs < echo.deliverMs) continue;

      // Deliver this echo
      pendingEchoes.splice(i, 1);

      const transformed = applyTransform(echo.intervals, echo.transform);

      // Convert intervals to absolute MIDI notes anchored on currentMidi
      const lo = Math.max(0, OCTAVE.min * 12 - 1);
      const hi = OCTAVE.max * 12 - 1;
      const notes = [currentMidi];
      let cursor = currentMidi;
      for (let j = 0; j < transformed.length; j++) {
        cursor = clamp(cursor + transformed[j], lo, hi);
        notes.push(cursor);
      }

      return { notes, transform: echo.transform, echoIndex: i };
    }
    return null;
  }

  /** @returns {number} count of pending echoes */
  function getPendingCount() { return pendingEchoes.length; }

  function reset() {
    pendingEchoes.length = 0;
    recentNotes.clear();
  }

  return { recordNote, captureMotif, applyTransform, deliverEcho, getPendingCount, reset };
})();
CrossLayerRegistry.register('MotifEcho', MotifEcho, ['all', 'phrase']);
