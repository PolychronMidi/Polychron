// variants/decayingBounce.js - ball-bounce decay: intervals AND velocity
// shrink exponentially, converging on silence. Source pitch only.

moduleLifecycle.declare({
  name: 'decayingBounceVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  provides: ['decayingBounceVariant'],
  init: () => {
    stutterVariants.register('decayingBounce', function decayingBounce(opts) {
      const bounces = ri(5, 10);
      const decayRate = rf(0.55, 0.75);
      let interval = opts.sustain * 0.2;
      let vel = opts.velocity;
      let t = opts.on;
      let lastShared = opts.shared;
      for (let i = 0; i < bounces; i++) {
        t += interval;
        if (t >= opts.on + opts.sustain) break;
        vel = m.round(vel * decayRate);
        if (vel < 8) break;
        interval *= decayRate;
        lastShared = stutterNotes(Object.assign({}, opts, {
          on: t,
          sustain: interval * 0.6,
          velocity: clamp(vel, 1, 127),
          binVel: clamp(vel, 1, 127)
        }));
      }
      return lastShared;
    }, 0.8, { selfGate: 0.8, maxPerSection: 200 });
    return { registered: true };
  },
});
