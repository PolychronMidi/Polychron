// variants/machineGun.js - rapid-fire 4-8 burst echoes with accelerando.
// First half: source pitch, second half: octave shifts.

moduleLifecycle.declare({
  name: 'machineGunVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  provides: ['machineGunVariant'],
  init: () => {
    stutterVariants.register('machineGun', function machineGun(opts) {
      const burstCount = ri(4, 8);
      const burstSpacing = opts.sustain / (burstCount + 1);
      let lastShared = opts.shared;
      for (let i = 0; i < burstCount; i++) {
        const progress = i / burstCount;
        const accelFactor = 1 - progress * 0.6;
        const burstOn = opts.on + burstSpacing * i * accelFactor;
        const vel = clamp(m.round(opts.velocity * (0.5 + progress * 0.5)), 1, 127);
        if (progress < 0.5) {
          p(c, { timeInSeconds: burstOn, type: 'on', vals: [opts.channel, opts.note, vel] });
          p(c, { timeInSeconds: burstOn + burstSpacing * 0.4, vals: [opts.channel, opts.note] });
        } else {
          lastShared = stutterNotes(Object.assign({}, opts, {
            on: burstOn, sustain: burstSpacing * 0.4, velocity: vel
          }));
        }
      }
      return lastShared;
    }, 0.6, { selfGate: 0.5, maxPerSection: 120 });
    return { registered: true };
  },
});
