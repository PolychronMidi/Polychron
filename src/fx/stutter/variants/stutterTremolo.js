// variants/stutterTremolo.js - ultra-rapid alternation between source note
// and its octave (up or down). Tremolo/trill effect using octave intervals.

moduleLifecycle.declare({
  name: 'stutterTremoloVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  lazyDeps: ['stutterShift'],
  provides: ['stutterTremoloVariant'],
  init: (deps) => {
    const stutterVariants = deps.stutterVariants;
    stutterVariants.register('stutterTremolo', function stutterTremolo(opts) {
      const altNote = stutterShift.pickOctaveAlternate(opts.note);
      if (altNote === opts.note) return stutterNotes(opts);
      const alternations = ri(15, 30);
      const stepDur = opts.sustain / alternations;
      let lastShared = opts.shared;
      for (let i = 0; i < alternations; i++) {
        const vel = clamp(m.round(opts.velocity * rf(0.55, 0.85)), 1, 127);
        lastShared = stutterNotes(Object.assign({}, opts, {
          note: i % 2 === 1 ? altNote : opts.note,
          on: opts.on + stepDur * i,
          sustain: stepDur * 0.7,
          velocity: vel, binVel: vel
        }));
      }
      return lastShared;
    }, 0.5, { selfGate: 0.45, maxPerSection: 140 });
    return { registered: true };
  },
});
