// variants/flickerStutter.js - echo density modulated by conductor flicker.
// High flicker = more rapid echoes. Low flicker = minimal stutter.

stutterVariants.register('flickerStutter', function flickerStutter(opts) {
  const sigs = conductorSignalBridge.getSignals();
  const flicker = clamp(sigs.flicker || 1.0, 0.1, 2.0);
  const echoCount = clamp(m.round(flicker * ri(2, 5)), 1, 7);
  const spacing = opts.sustain / (echoCount + 1) / m.max(0.5, flicker);
  let lastShared = opts.shared;
  for (let i = 0; i < echoCount; i++) {
    const vel = clamp(m.round(opts.velocity * rf(0.25, 0.55) * flicker), 1, 127);
    lastShared = stutterNotes(Object.assign({}, opts, {
      on: opts.on + spacing * (i + 1),
      sustain: spacing * 0.6,
      velocity: vel, binVel: vel
    }));
  }
  return lastShared;
}, 0.9, { selfGate: 0.7, maxPerSection: 150 });
