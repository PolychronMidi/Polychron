// variants/reverseVelocity.js - echoes start loud and decay toward source velocity.
// Creates a "pre-echo" illusion implying reversed tape.

stutterVariants.register('reverseVelocity', function reverseVelocity(opts) {
  const echoCount = ri(3, 5);
  let lastShared = opts.shared;
  for (let i = 0; i < echoCount; i++) {
    const progress = i / echoCount;
    const vel = clamp(m.round(127 - progress * (127 - opts.velocity)), 1, 127);
    const spacing = opts.sustain * 0.15;
    lastShared = stutterNotes(Object.assign({}, opts, {
      on: opts.on + spacing * i,
      sustain: opts.sustain * rf(0.15, 0.25),
      velocity: vel, binVel: vel
    }));
  }
  return lastShared;
}, 0.8, { selfGate: 0.7, maxPerSection: 170 });
