// stutterShift.js - boundary-safe MIDI shift primitives for stutter variants.
// Single source of truth for note-range math. Variants that implemented this
// themselves previously drifted into three distinct bugs (clamp vs modClamp
// vs break vs continue, plus upward-first bias in stutterTremolo).

stutterShift = (() => {
  const V = validator.create('stutterShift');
  const bassMax = 59;
  const rangeFor = (isBass) => ({ lo: minMidi, hi: isBass ? bassMax : maxMidi });

  // Shift a note by a semitone amount. Wraps through the range (modClamp) by
  // default -- ascending past the ceiling resumes from the floor. Set wrap:false
  // to clamp at the boundary instead.
  const shift = (note, semitones, opts = {}) => {
    V.requireFinite(note, 'note');
    V.requireFinite(semitones, 'semitones');
    const { isBass = false, wrap = true } = opts;
    const { lo, hi } = rangeFor(isBass);
    const target = note + semitones;
    return wrap ? modClamp(target, lo, hi) : clamp(target, lo, hi);
  };

  // Pick an octave alternate of `note`: symmetric random between octUp/octDown
  // when both fit the range, otherwise whichever fits. Returns `note` when
  // neither fits (caller decides to fall through to source-only emission).
  const pickOctaveAlternate = (note, opts = {}) => {
    V.requireFinite(note, 'note');
    const { isBass = false } = opts;
    const { lo, hi } = rangeFor(isBass);
    const up = note + 12;
    const down = note - 12;
    const upOk = up <= hi;
    const downOk = down >= lo;
    if (upOk && downOk) return rf() < 0.5 ? up : down;
    if (upOk) return up;
    if (downOk) return down;
    return note;
  };

  // All valid octave positions of a pitch class within the range,
  // optionally excluding a specific MIDI note (typically the source).
  const enumerateOctaves = (pitchClass, opts = {}) => {
    V.requireFinite(pitchClass, 'pitchClass');
    const { isBass = false, exclude = null } = opts;
    const { lo, hi } = rangeFor(isBass);
    const pc = ((pitchClass % 12) + 12) % 12;
    const result = [];
    for (let n = pc; n <= hi; n += 12) {
      if (n >= lo && n !== exclude) result.push(n);
    }
    return result;
  };

  return { shift, pickOctaveAlternate, enumerateOctaves };
})();
