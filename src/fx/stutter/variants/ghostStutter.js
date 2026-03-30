// variants/ghostStutter.js - extremely quiet octave echoes at velocity 15-30.
// Subliminal harmonic reinforcement. Legendary: most reductive variant,
// handles higher stutter rates without overload.

stutterVariants.register('ghostStutter', function ghostStutter(opts) {
  const ghostCount = ri(2, 4);
  let lastShared = opts.shared;
  for (let i = 0; i < ghostCount; i++) {
    const vel = ri(15, 30);
    lastShared = stutterNotes(Object.assign({}, opts, {
      on: opts.on + opts.sustain * rf(0.05, 0.4),
      sustain: opts.sustain * rf(0.3, 0.7),
      velocity: vel, binVel: vel
    }));
  }
  return lastShared;
}, 1.2);
