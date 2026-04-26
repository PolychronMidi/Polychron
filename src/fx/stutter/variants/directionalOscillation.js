// variants/directionalOscillation.js - stutter series that oscillates between
// ascending and descending octave shifts. Each invocation picks a direction,
// successive echoes shift further in that direction, then reverse.

moduleLifecycle.declare({
  name: 'directionalOscillationVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  lazyDeps: ['stutterShift'],
  provides: ['directionalOscillationVariant'],
  init: () => {
    stutterVariants.register('directionalOscillation', function directionalOscillation(opts) {
      const steps = ri(4, 7);
      const ascending = rf() < 0.5;
      let lastShared = opts.shared;
      for (let i = 0; i < steps; i++) {
        // Oscillate: first half goes one direction, second half reverses
        const halfPoint = steps / 2;
        const direction = (i < halfPoint) === ascending ? 1 : -1;
        const magnitude = (i < halfPoint ? i + 1 : steps - i) * 12;
        const targetNote = stutterShift.shift(opts.note, direction * magnitude);
        const progress = i / steps;
        const vel = clamp(m.round(opts.velocity * rf(0.3, 0.55) * (1 - progress * 0.3)), 1, 127);
        lastShared = stutterNotes(Object.assign({}, opts, {
          note: targetNote,
          on: opts.on + opts.sustain * 0.08 * i,
          sustain: opts.sustain * rf(0.12, 0.25),
          velocity: vel, binVel: vel
        }));
      }
      return lastShared;
    }, 0.7, { selfGate: 0.6, maxPerSection: 150 });
    return { registered: true };
  },
});
