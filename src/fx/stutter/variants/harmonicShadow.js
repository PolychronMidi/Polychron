// variants/harmonicShadow.js - echo jumps to farthest valid octave from
// source, creating deliberate register contrast. Single quiet echo.

stutterVariants.register('harmonicShadow', function harmonicShadow(opts) {
  const pc = opts.note % 12;
  const sourceOct = m.floor(opts.note / 12);
  const minOct = OCTAVE.min;
  const maxOct = OCTAVE.max;
  const candidates = [];
  for (let oct = minOct; oct <= maxOct; oct++) {
    if (oct !== sourceOct) {
      candidates.push({ oct, dist: m.abs(oct - sourceOct), note: oct * 12 + pc });
    }
  }
  if (candidates.length === 0) return stutterNotes(opts);
  candidates.sort((a, b) => b.dist - a.dist);
  const pick = candidates[ri(m.min(1, candidates.length - 1))];
  const vel = clamp(m.round(opts.velocity * rf(0.35, 0.55)), 1, 127);
  return stutterNotes(Object.assign({}, opts, {
    note: pick.note,
    on: opts.on + opts.sustain * rf(0.05, 0.2),
    sustain: opts.sustain * rf(0.3, 0.6),
    velocity: vel, binVel: vel
  }));
}, 0.9, { selfGate: 0.85, maxPerSection: 180 });
