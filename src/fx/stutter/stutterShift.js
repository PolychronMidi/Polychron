// stutterShift.js - boundary-safe MIDI shift primitives for stutter variants.
// Single source of truth for note-range math. Variants that implemented this
// themselves previously drifted into three distinct bugs (clamp vs modClamp
// vs break vs continue, plus upward-first bias in stutterTremolo).

moduleLifecycle.declare({
  name: 'stutterShift',
  subsystem: 'fx',
  deps: ['validator'],
  provides: ['stutterShift'],
  init: (deps) => {
  const V = deps.validator.create('stutterShift');
  const bassMax = 59;
  const rangeFor = (isBass) => ({ lo: minMidi, hi: isBass ? bassMax : maxMidi });

  // Shift a note by a semitone amount. Wraps through the range (modClamp) by
  const shift = (note, semitones, opts = {}) => {
    V.requireFinite(note, 'note');
    V.requireFinite(semitones, 'semitones');
    const { isBass = false, wrap = true } = opts;
    const { lo, hi } = rangeFor(isBass);
    const target = note + semitones;
    return wrap ? modClamp(target, lo, hi) : clamp(target, lo, hi);
  };

  // Pick an octave alternate of `note`: symmetric random between octUp/octDown
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
  },
});
