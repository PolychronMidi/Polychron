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
 * @param {Array<string|number>} [scale]
 * @param {number} [degreeOffset=0]
 * @param {Object} [opts]
 * @param {boolean} [opts.quantize=false]
 * @returns {number|object|Array<number|object>}
 */
scaleDegreeTranspose = function(noteOrMidi, scale = null, degreeOffset = 0, opts = {}) {
  const _transposeSingle = (input) => {
    // Resolve MIDI value from input
    const getMidi = (x) => {
      if (typeof x === 'number') return x;
      if (x && typeof x === 'object' && typeof x.note === 'number') return x.note;
      if (typeof x === 'string' && typeof t !== 'undefined' && t.Note) {
        const v = t.Note.midi(x);
        if (Number.isFinite(v)) return v;
      }
      return null;
    };

    const midi = getMidi(input);
    if (!Number.isFinite(midi)) throw new Error('scaleDegreeTranspose: invalid note input');

    // Resolve scale array (prefer explicit scale; fall back to HarmonicContext)
    let theScale = scale;
    if (!theScale || !Array.isArray(theScale) || theScale.length === 0) {
      if (typeof HarmonicContext !== 'undefined') {
        theScale = HarmonicContext.getField('scale');
      }
    }
    if (!theScale || !Array.isArray(theScale) || theScale.length === 0) {
      throw new Error('scaleDegreeTranspose: scale must be provided or available via HarmonicContext');
    }

    // Map scale to pitch-classes (preserve the original order)
    const scalePC = theScale.map((s) => {
      if (typeof s === 'number') return ((s % 12) + 12) % 12;
      if (typeof s === 'string') {
        if (typeof t === 'undefined' || !t.Note || typeof t.Note.chroma !== 'function') throw new Error('scaleDegreeTranspose: tonal.js not available');
        const c = t.Note.chroma(s);
        if (!Number.isFinite(c) || c < 0) throw new Error('scaleDegreeTranspose: invalid scale entry "' + String(s) + '"');
        return c;
      }
      throw new Error('scaleDegreeTranspose: unsupported scale entry type');
    });

    const scaleLen = scalePC.length;
    if (scaleLen === 0) throw new Error('scaleDegreeTranspose: empty scale');

    const pitchClass = ((midi % 12) + 12) % 12;

    // Find degree index for this pitch-class in the scale (search order-preserving)
    let degreeIndex = -1;
    for (let i = 0; i < scalePC.length; i++) {
      if (scalePC[i] === pitchClass) { degreeIndex = i; break; }
    }

    if (degreeIndex === -1) {
      if (opts && opts.quantize) {
        // Find nearest scale tone (in semitones) within the same octave
        const baseOct = Math.floor(midi / 12);
        let best = { idx: 0, dist: Infinity, midi: null };
        for (let i = 0; i < scalePC.length; i++) {
          const cand = baseOct * 12 + scalePC[i];
          const d = Math.abs(cand - midi);
          if (d < best.dist) best = { idx: i, dist: d, midi: cand };
        }
        degreeIndex = best.idx;
      } else {
        throw new Error('scaleDegreeTranspose: input note is not a member of the provided scale');
      }
    }

    // Compute absolute degree index and target index + octave shift
    const absIndex = degreeIndex + Number(degreeOffset || 0);
    const octaveShift = Math.floor(absIndex / scaleLen);
    const targetIdx = ((absIndex % scaleLen) + scaleLen) % scaleLen;

    const baseOctave = Math.floor(midi / 12);
    const targetPC = scalePC[targetIdx];
    const resultMidi = clamp((baseOctave + octaveShift) * 12 + targetPC, 0, 127);

    // Return same shape as input
    if (typeof input === 'number') return resultMidi;
    const out = Object.assign({}, input);
    out.note = resultMidi;
    return out;
  };

  // If array input, map across items
  if (Array.isArray(noteOrMidi)) {
    return noteOrMidi.map(it => _transposeSingle(it));
  }

  return _transposeSingle(noteOrMidi);
};

// alias `scaleDegreeTransposeAll` removed — use `scaleDegreeTranspose(...)` which accepts arrays.
