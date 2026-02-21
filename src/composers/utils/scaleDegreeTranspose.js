/**
 * scaleDegreeTranspose
 * Transpose a note (or array of notes) by diatonic scale degrees while preserving scale membership.
 * - Accepts a single MIDI number, an object with `.note`, or an array of those.
 * - If `scale` is omitted the function falls back to `HarmonicContext.getField('scale')`.
 * - `degreeOffset` moves by diatonic steps (positive or negative).
 * - `opts.quantize` will quantize an out-of-scale input to the nearest scale degree before transposing.
 *
 * Returns a MIDI number for single input, or an array of MIDI numbers/objects when given an array.
 *
 * Example: scaleDegreeTranspose(60, ['C','D','E','F','G','A','B'], 1) -> 62 (C4 -> D4)
 *
 * This is the canonical, composer-side implementation (loaded as a naked global).
 *
 * @param {number|object|Array<number|object>} noteOrMidi
 * @param {Array<string|number>|null} [scale]
 * @param {number} [degreeOffset=0]
 * @param {Object} [opts]
 * @param {boolean} [opts.quantize=false]
 * @returns {number|object|Array<number|object>}
 */
scaleDegreeTranspose = function(noteOrMidi, scale = null, degreeOffset = 0, opts = {}) {
  return transposeByDegree(noteOrMidi, scale, degreeOffset, opts);
};

// alias `scaleDegreeTransposeAll` removed — use `scaleDegreeTranspose(...)` which accepts arrays.
