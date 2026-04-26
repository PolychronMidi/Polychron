// variants/rhythmicGrid.js - echoes quantized to subdivision grid boundaries.
// Creates metrically precise stutter patterns.

moduleLifecycle.declare({
  name: 'rhythmicGridVariant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  provides: ['rhythmicGridVariant'],
  init: (deps) => {
    const stutterVariants = deps.stutterVariants;
    stutterVariants.register('rhythmicGrid', function rhythmicGrid(opts) {
      const gridSize = spBeat / ri(4, 8);
      const echoCount = ri(2, 5);
      let lastShared = opts.shared;
      for (let i = 1; i <= echoCount; i++) {
        const rawTime = opts.on + gridSize * i;
        const snapped = m.round(rawTime / gridSize) * gridSize;
        if (snapped >= opts.on + opts.sustain) break;
        lastShared = stutterNotes(Object.assign({}, opts, {
          on: snapped,
          sustain: gridSize * 0.7,
          velocity: m.round(opts.velocity * rf(0.6, 0.9))
        }));
      }
      return lastShared;
    }, 1.0, { selfGate: 0.9, maxPerSection: 220 });
    return { registered: true };
  },
});
