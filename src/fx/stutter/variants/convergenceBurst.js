// variants/convergenceBurst.js - dense ghost-quiet burst ONLY at layer
// convergence points. Silent when layers diverge. Creates emergent
// stutter at points of inter-layer rhythmic agreement.

stutterVariants.register('convergenceBurst', function convergenceBurst(opts) {
  const layer = LM.activeLayer || 'L1';
  if (!convergenceDetector.wasRecent(opts.on, layer, 300)) return opts.shared;
  // Dense ghost-quiet burst at convergence points
  const burstSize = ri(4, 7);
  let lastShared = opts.shared;
  for (let i = 0; i < burstSize; i++) {
    const vel = ri(12, 28);
    lastShared = stutterNotes(Object.assign({}, opts, {
      on: opts.on + opts.sustain * rf(0.02, 0.3),
      sustain: opts.sustain * rf(0.2, 0.5),
      velocity: vel, binVel: vel
    }));
  }
  return lastShared;
}, 0.7, { selfGate: 0.9, maxPerSection: 200 });
