// variants/convergenceBurst.js - dense ghost-quiet burst ONLY at layer
// convergence points. R17: limited to 3-10s windows per convergence event
// to prevent sustained overwhelming. Silent when layers diverge.

let convergenceBurstWindowStart = -Infinity;
let convergenceBurstWindowActive = false;

stutterVariants.register('convergenceBurst', function convergenceBurst(opts) {
  const layer = /** @type {string} */ (LM.activeLayer);
  const converged = convergenceDetector.wasRecent(opts.on, layer, 300);

  if (converged && !convergenceBurstWindowActive) {
    // Start a new burst window
    convergenceBurstWindowActive = true;
    convergenceBurstWindowStart = opts.on;
  } else if (!converged) {
    convergenceBurstWindowActive = false;
  }

  if (!convergenceBurstWindowActive) return opts.shared;

  // Only fire within 3-10s of window start
  const windowAge = opts.on - convergenceBurstWindowStart;
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
