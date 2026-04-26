// variants/stereoScatter.js - echoes distributed across L/R channels.
// During flipBinCrossfade window: ultra-rapid near-simultaneous echoes
// across all channels to create reverb-wash smudge that blurs detune
// artifacts, plus rapid pan CC jitter for spatial blur.
// Outside crossfade: subtle widening with ghost-quiet opposite-side echoes.

moduleLifecycle.declare({
  name: 'stereoScatterVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  provides: ['stereoScatterVariant'],
  init: (deps) => {
    const stutterVariants = deps.stutterVariants;
    stutterVariants.register('stereoScatter', function stereoScatter(opts) {
      const allChs = source.concat(reflection);
      if (allChs.length === 0) return stutterNotes(opts);

      const inCrossfade = opts.on >= flipBinCrossfadeWindow[0]
        && opts.on <= flipBinCrossfadeWindow[1];

      let lastShared = opts.shared;
      if (inCrossfade) {
        // Reverb-wash smudge: many ultra-short, near-simultaneous echoes across
        // all channels. Barely distinguishable as discrete events - acts as wash.
        const echoCount = ri(6, 10);
        for (let i = 0; i < echoCount; i++) {
          const ch = allChs[i % allChs.length];
          const vel = clamp(m.round(opts.velocity * rf(0.2, 0.4)), 1, 127);
          // Ultra-short spacing: 2-8ms apart, barely perceptible as separate
          const microOffset = rf(0.002, 0.008) * i;
          lastShared = stutterNotes(Object.assign({}, opts, {
            channel: ch,
            on: opts.on + microOffset,
            sustain: rf(0.01, 0.04),
            velocity: vel, binVel: vel
          }));
        }
        // Rapid pan CC jitter across channels during crossfade
        const panSteps = ri(4, 8);
        const panDuration = flipBinCrossfadeWindow[1] - flipBinCrossfadeWindow[0];
        for (let i = 0; i < panSteps; i++) {
          const t = opts.on + (panDuration / panSteps) * i;
          const panVal = m.round(64 + rf(-40, 40));
          for (let j = 0; j < allChs.length; j++) {
            const jitteredPan = clamp(panVal + ri(-10, 10), 0, 127);
            channelStateField.observeControl(allChs[j], 10, jitteredPan, 'stereoScatter');
            p(c, { timeInSeconds: t, type: 'control_c', vals: [allChs[j], 10, jitteredPan] });
          }
        }
      } else {
        // Subtle widening: 1-2 ghost-quiet echoes on opposite-side channels
        const oppositeChs = flipBin ? flipBinF3 : flipBinT3;
        if (oppositeChs.length === 0) return stutterNotes(opts);
        const echoCount = ri(1, 2);
        for (let i = 0; i < echoCount; i++) {
          const ch = oppositeChs[ri(oppositeChs.length - 1)];
          const vel = clamp(ri(12, 25), 1, 127);
          lastShared = stutterNotes(Object.assign({}, opts, {
            channel: ch,
            on: opts.on + opts.sustain * rf(0.05, 0.2),
            sustain: opts.sustain * rf(0.2, 0.4),
            velocity: vel, binVel: vel
          }));
        }
      }
      return lastShared;
    }, 0.8, { selfGate: 0.8, maxPerSection: 200 });
    return { registered: true };
  },
});
