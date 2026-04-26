// variants/convergenceBurst.js - dense ghost-quiet burst ONLY at layer
// convergence points. R17: limited to 3-10s windows per convergence event
// to prevent sustained overwhelming. Silent when layers diverge.

// Per-layer burst window state prevents L1/L2 cross-contamination

moduleLifecycle.declare({
  name: 'convergenceBurst-variant',
  subsystem: 'fx',
  deps: ['stutterVariants'],
  provides: ['convergenceBurst-variant'],
  init: () => {
    const convergenceBurstByLayer = {};
    function getLayerBurst(layer) {
      if (!convergenceBurstByLayer[layer]) {
        convergenceBurstByLayer[layer] = { windowStart: -Infinity, windowActive: false };
      }
      return convergenceBurstByLayer[layer];
    }

    stutterVariants.register('convergenceBurst', function convergenceBurst(opts) {
      const layer = /** @type {string} */ (LM.activeLayer);
      const burst = getLayerBurst(layer);
      const converged = convergenceDetector.wasRecent(opts.on, layer, 300);

      if (converged && !burst.windowActive) {
        burst.windowActive = true;
        burst.windowStart = opts.on;
      } else if (!converged) {
        burst.windowActive = false;
      }

      if (!burst.windowActive) return opts.shared;

      // Only fire within 3-10s of window start
      const windowAge = opts.on - burst.windowStart;
      if (windowAge < 3 || windowAge > 10) return opts.shared;

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
    }, 0.7, { selfGate: 0.95, maxPerSection: 280 });
    return { registered: true };
  },
});
