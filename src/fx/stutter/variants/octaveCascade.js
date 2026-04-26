// variants/octaveCascade.js - each echo shifts one octave further from source.
// Ascending or descending waterfall, direction chosen per-note.


moduleLifecycle.registerInitializer('octaveCascade-registration', () => {
  stutterVariants.register('octaveCascade', function octaveCascade(opts) {
    const direction = rf() < 0.5 ? 1 : -1;
    const steps = ri(3, 5);
    let lastShared = opts.shared;
    for (let i = 0; i < steps; i++) {
      const targetNote = stutterShift.shift(opts.note, direction * (i + 1) * 12);
      lastShared = stutterNotes(Object.assign({}, opts, {
        note: targetNote,
        on: opts.on + opts.sustain * 0.12 * i,
        sustain: opts.sustain * rf(0.15, 0.3),
        velocity: m.round(opts.velocity * (1 - i * 0.15))
      }));
    }
    return lastShared;
  }, 0.7, { selfGate: 0.6, maxPerSection: 140 });

}, ['stutterVariants']);
