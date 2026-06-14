/**
 * scaleDegreeTranspose
 * Transpose one note or an array by diatonic scale degrees while staying in scale.
 * - Accepts a single MIDI number, an object with `.note`, or an array of those.
 * - Missing scale falls back to harmonicContext.getField('scale').
 * - `degreeOffset` moves by diatonic steps (positive or negative).
 * - opts.quantize snaps out-of-scale input before transposing.
 *
 * Returns one MIDI number or an array matching the input shape.
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
