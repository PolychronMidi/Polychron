// variants/harmonicShadow.js - echo jumps to farthest valid octave from
// source, creating deliberate register contrast. Single quiet echo.

moduleLifecycle.declare({
  name: 'harmonicShadow-variant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  provides: ['harmonicShadow-variant'],
  init: () => {
    stutterVariants.register('harmonicShadow', function harmonicShadow(opts) {
      const sourceOct = m.floor(opts.note / 12);
      const notes = stutterShift.enumerateOctaves(opts.note % 12, { exclude: opts.note });
      if (notes.length === 0) return stutterNotes(opts);
      const candidates = notes.map((note) => ({ note, dist: m.abs(m.floor(note / 12) - sourceOct) }));
      candidates.sort((a, b) => b.dist - a.dist);
      const pick = candidates[ri(m.min(1, candidates.length - 1))];
      const vel = clamp(m.round(opts.velocity * rf(0.35, 0.55)), 1, 127);
      return stutterNotes(Object.assign({}, opts, {
        note: pick.note,
        on: opts.on + opts.sustain * rf(0.05, 0.2),
        sustain: opts.sustain * rf(0.3, 0.6),
        velocity: vel, binVel: vel
      }));
    }, 0.9, { selfGate: 0.9, maxPerSection: 250 });
    return { registered: true };
  },
});
