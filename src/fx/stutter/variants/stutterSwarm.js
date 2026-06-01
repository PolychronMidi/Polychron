// variants/stutterSwarm.js - simultaneous cluster of 3-6 octave-stacked stutters.
// Vertical "chord" of octave multiples - no voicing conflict.

moduleLifecycle.declare({
  name: 'stutterSwarmVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  lazyDeps: ['stutterShift'],
  provides: ['stutterSwarmVariant'],
  init: (deps) => {
    const stutterVariants = deps.stutterVariants;
    stutterVariants.register('stutterSwarm', function stutterSwarm(opts) {
      const swarmSize = ri(3, 6);
      const octaveNotes = stutterShift.enumerateOctaves(opts.note % 12, { exclude: opts.note });
      for (let i = octaveNotes.length - 1; i > 0; i--) {
        const j = ri(i);
        const tmp = octaveNotes[i];
        octaveNotes[i] = octaveNotes[j];
        octaveNotes[j] = tmp;
      }
      const chosen = octaveNotes.slice(0, swarmSize);
      const swarmOn = opts.on + opts.sustain * rf(0.05, 0.15);
      let lastShared = opts.shared;
      for (let i = 0; i < chosen.length; i++) {
        const vel = clamp(m.round(opts.velocity * rf(0.4, 0.85)), 1, 127);
        lastShared = stutterNotes(Object.assign({}, opts, {
          note: chosen[i],
          on: swarmOn + rf(-0.005, 0.005),
          sustain: opts.sustain * rf(0.25, 0.5),
          velocity: vel, binVel: vel
        }));
      }
      return lastShared;
    }, 0.6, { selfGate: 0.5, maxPerSection: 120 });
    return { registered: true };
  },
});
