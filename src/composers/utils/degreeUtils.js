/**
 * Resolve a scale to ordered pitch classes (0-11).
 * Accepts note names or numeric pitch classes and falls back to HarmonicContext when omitted.
 * @param {Array<string|number>|null} scale
 * @returns {number[]}
 */
resolveScalePC = function(scale = null) {
  let theScale = scale;
  if (!Array.isArray(theScale) || theScale.length === 0) {
    if (typeof HarmonicContext !== 'undefined') theScale = HarmonicContext.getField('scale');
  }
  if (!Array.isArray(theScale) || theScale.length === 0) throw new Error('resolveScalePC: scale must be provided or available via HarmonicContext');

  // Narrow type for TypeScript/checkJs
  const finalScale = /** @type {(string|number)[]} */ (theScale);
  return finalScale.map((s) => {
    if (typeof s === 'number') return ((s % 12) + 12) % 12;
    if (typeof s === 'string') {
      if (typeof t === 'undefined' || !t.Note || typeof t.Note.chroma !== 'function') throw new Error('resolveScalePC: tonal.js not available');
      const c = t.Note.chroma(s);
      if (!Number.isFinite(c) || c < 0) throw new Error('resolveScalePC: invalid scale note "' + s + '"');
      return c;
    }
    throw new Error('resolveScalePC: unsupported scale entry type');
  });
};

/**
 * Convert a note to degree-space coordinates for a given scale.
 * @param {number|{note:number}} noteOrMidi
 * @param {Array<string|number>|null} scale
 * @param {{ quantize?: boolean }} [opts]
 * @returns {{ degree:number, octave:number, absDegree:number, midi:number, scalePC:number[] }}
 */
midiToDegree = function(noteOrMidi, scale = null, opts = {}) {
  const midi = (typeof noteOrMidi === 'number') ? noteOrMidi : (noteOrMidi && typeof noteOrMidi.note === 'number' ? noteOrMidi.note : NaN);
  if (!Number.isFinite(midi)) throw new Error('midiToDegree: noteOrMidi must be a number or {note:number}');
  const scalePC = resolveScalePC(scale);

  const pc = ((midi % 12) + 12) % 12;
  let degree = scalePC.indexOf(pc);
  let midiUsed = midi;

  if (degree === -1) {
    if (!opts || opts.quantize !== true) throw new Error('midiToDegree: note pitch class is not in scale');
    const baseOct = Math.floor(midi / 12);
    let bestIdx = -1;
    let bestDist = Infinity;
    let bestMidi = midi;
    for (let i = 0; i < scalePC.length; i++) {
      const candidates = [baseOct - 1, baseOct, baseOct + 1].map(oct => oct * 12 + scalePC[i]);
      for (const cand of candidates) {
        const d = Math.abs(cand - midi);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
          bestMidi = cand;
        }
      }
    }
    if (bestIdx < 0) throw new Error('midiToDegree: quantization failed to find scale degree');
    degree = bestIdx;
    midiUsed = bestMidi;
  }

  const octave = Math.floor(midiUsed / 12);
  const absDegree = octave * scalePC.length + degree;
  return { degree, octave, absDegree, midi: midiUsed, scalePC };
};

/**
 * Convert a degree index back to MIDI for a given scale and octave.
 * @param {number} degree
 * @param {Array<string|number>|null} scale
 * @param {number} octave
 * @param {{ clampToMidi?: boolean }} [opts]
 * @returns {number}
 */
degreeToMidi = function(degree, scale = null, octave = 4, opts = {}) {
  if (!Number.isFinite(Number(degree))) throw new Error('degreeToMidi: degree must be finite number');
  if (!Number.isFinite(Number(octave))) throw new Error('degreeToMidi: octave must be finite number');
  const scalePC = resolveScalePC(scale);
  const len = scalePC.length;
  if (len <= 0) throw new Error('degreeToMidi: resolved empty scale');

  const d = Number(degree);
  const degInOct = ((d % len) + len) % len;
  const octShift = Math.floor(d / len);
  const rawMidi = (Number(octave) + octShift) * 12 + scalePC[degInOct];
  return (opts && opts.clampToMidi === false) ? rawMidi : clamp(rawMidi, 0, 127);
};

/**
 * Transpose note(s) by diatonic scale degree offset.
 * @param {number|{note:number}|Array<number|{note:number}>} noteOrMidi
 * @param {Array<string|number>|null} scale
 * @param {number} degreeOffset
 * @param {{ quantize?: boolean, clampToMidi?: boolean }} [opts]
 * @returns {number|{note:number}|Array<number|{note:number}>}
 */
transposeByDegree = function(noteOrMidi, scale = null, degreeOffset = 0, opts = {}) {
  const transformOne = (input) => {
    const info = midiToDegree(input, scale, { quantize: Boolean(opts && opts.quantize) });
    const targetAbs = info.absDegree + Number(degreeOffset || 0);
    const targetOct = Math.floor(targetAbs / info.scalePC.length);
    const targetDeg = ((targetAbs % info.scalePC.length) + info.scalePC.length) % info.scalePC.length;
    const outMidiRaw = targetOct * 12 + info.scalePC[targetDeg];
    const outMidi = (opts && opts.clampToMidi === false) ? outMidiRaw : clamp(outMidiRaw, 0, MIDI_MAX_VALUE);
    if (typeof input === 'number') return outMidi;
    const copy = Object.assign({}, input);
    copy.note = outMidi;
    return copy;
  };

  if (Array.isArray(noteOrMidi)) return noteOrMidi.map(transformOne);
  return transformOne(noteOrMidi);
};
