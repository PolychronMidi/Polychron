// variants/echoTrail.js - growing inter-echo delay with decaying velocity.
// Creates trailing echoes that spread out and fade over time.

stutterVariants.register('echoTrail', function echoTrail(opts) {
  const trails = ri(4, 7);
  const delayGrowth = rf(1.3, 1.8);
  let delay = opts.sustain * 0.15;
  let vel = opts.velocity;
  let t = opts.on;
  let lastShared = opts.shared;
  for (let i = 0; i < trails; i++) {
    t += delay;
    if (t >= opts.on + opts.sustain * 2.5) break;
    vel = m.round(vel * rf(0.45, 0.65));
    if (vel < 8) break;
    delay *= delayGrowth;
    lastShared = stutterNotes(Object.assign({}, opts, {
      on: t,
      sustain: delay * 0.8,
      velocity: clamp(vel, 1, 127),
      binVel: clamp(vel, 1, 127)
    }));
  }
  return lastShared;
}, 0.9, { selfGate: 0.85, maxPerSection: 220 });
