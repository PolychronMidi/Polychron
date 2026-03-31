// variants/tensionStutter.js - echo count and velocity driven by conductor
// tension. High tension = more aggressive echoes. Low tension = sparse/soft.
// Tracks the emotional arc through stutter texture.

stutterVariants.register('tensionStutter', function tensionStutter(opts) {
  const sigs = conductorSignalBridge.getSignals();
  const tension = clamp(sigs.tension || 1.0, 0.3, 2.0);
  const echoCount = clamp(m.round(tension * ri(2, 4)), 1, 6);
  let lastShared = opts.shared;
  for (let i = 0; i < echoCount; i++) {
    const vel = clamp(m.round(opts.velocity * tension * rf(0.3, 0.6)), 1, 127);
    const spacing = opts.sustain * rf(0.08, 0.2);
    lastShared = stutterNotes(Object.assign({}, opts, {
      on: opts.on + spacing * i,
      sustain: spacing * 0.6,
      velocity: vel, binVel: vel
    }));
  }
  return lastShared;
}, 0.7, { selfGate: 0.6, maxPerSection: 120 });
