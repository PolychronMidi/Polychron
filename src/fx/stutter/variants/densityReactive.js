// variants/densityReactive.js - echo count inversely proportional to conductor
// density. Sparse passages get more echoes (fill space), dense get fewer.


moduleLifecycle.registerInitializer('densityReactive-registration', () => {
  stutterVariants.register('densityReactive', function densityReactive(opts) {
    const sigs = conductorSignalBridge.getSignals();
    const density = clamp(sigs.density ?? 1.0, 0.1, 2.0);
    // Inverse: low density = more echoes, high = fewer
    const echoCount = clamp(m.round(7 * (1 / density) * rf(0.7, 1.1)), 1, 6);
    let lastShared = opts.shared;
    for (let i = 0; i < echoCount; i++) {
      const vel = clamp(m.round(opts.velocity * rf(0.3, 0.55) / density), 1, 127);
      lastShared = stutterNotes(Object.assign({}, opts, {
        on: opts.on + opts.sustain * rf(0.05, 0.35) * (i + 1) / echoCount,
        sustain: opts.sustain * rf(0.2, 0.45),
        velocity: vel, binVel: vel
      }));
    }
    return lastShared;
  }, 0.9, { selfGate: 0.8, maxPerSection: 210 });

}, ['stutterVariants']);
