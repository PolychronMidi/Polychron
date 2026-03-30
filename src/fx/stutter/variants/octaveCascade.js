// variants/octaveCascade.js - each echo shifts one octave further from source.
// Ascending or descending waterfall, direction chosen per-note.

stutterVariants.register('octaveCascade', function octaveCascade(opts) {
  const direction = rf() < 0.5 ? 1 : -1;
  const steps = ri(3, 5);
  const minMidi = OCTAVE.min * 12;
  const maxMidi = OCTAVE.max * 12 - 1;
  let lastShared = opts.shared;
  for (let i = 0; i < steps; i++) {
    const shiftSemitones = direction * (i + 1) * 12;
    const targetNote = opts.note + shiftSemitones;
    if (targetNote < minMidi || targetNote > maxMidi) break;
    lastShared = stutterNotes(Object.assign({}, opts, {
      note: targetNote,
      on: opts.on + opts.sustain * 0.12 * i,
      sustain: opts.sustain * rf(0.15, 0.3),
      velocity: m.round(opts.velocity * (1 - i * 0.15))
    }));
  }
  return lastShared;
}, 0.7);
