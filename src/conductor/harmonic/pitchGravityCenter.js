// src/conductor/pitchGravityCenter.js - Weighted average pitch ("center of gravity").
// Detects tonal drift vs. anchoring across the recent note window.
// Pure query API - advises register shifts toward or away from a tonal anchor.

moduleLifecycle.declare({
  name: 'pitchGravityCenter',
  subsystem: 'conductor',
  deps: ['validator'],
  lazyDeps: ['analysisHelpers'],
  provides: ['pitchGravityCenter'],
  conductorScopes: ['section'],
  stateProvider: () => ({
    ...pitchGravityCenter.getGravityCenter(),
    crossDrift: pitchGravityCenter.getCrossLayerDrift(),
  }),
  init: (deps) => {
  const V = deps.validator.create('pitchGravityCenter');
  const query = analysisHelpers.createTrackerQuery(V, 6, { minNotes: 1 });
  const ANCHOR_PITCH = 60; // Middle C as default tonal anchor

  /**
   * Get the current pitch center of gravity.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ center: number, drift: number, anchored: boolean }}
   */
  function getGravityCenter(opts = {}) {
    const notes = query(opts);
    if (!notes) return { center: ANCHOR_PITCH, drift: 0, anchored: true };
    const velocities = analysisHelpers.extractVelocityArray(notes, 64);
    const midis = analysisHelpers.extractMidiArray(notes, ANCHOR_PITCH);

    // Velocity-weighted average pitch
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < midis.length; i++) {
      const vel = velocities[i];
      const midi = midis[i];
      weightedSum += midi * vel;
      totalWeight += vel;
    }

    const center = totalWeight > 0 ? weightedSum / totalWeight : ANCHOR_PITCH;
    const drift = center - ANCHOR_PITCH;
    const anchored = m.abs(drift) < 7;

    return { center, drift, anchored };
  }

  /**
   * Get a register bias to pull/push pitch toward/from the anchor.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ octaveBias: number, direction: string }}
   */
  function getGravityBias(opts) {
    const gc = getGravityCenter(opts);

    if (m.abs(gc.drift) < 5) {
      return { octaveBias: 0, direction: 'stable' };
    }

    // Drift > 0 means center is above anchor - pull down
    // Drift < 0 means center is below anchor - push up
    const octaveBias = clamp(-gc.drift / 12, -2, 2);
    const direction = gc.drift > 0 ? 'descend' : 'ascend';

    return { octaveBias, direction };
  }

  /**
   * Check if both layers have drifted in the same direction (parallel drift).
   * @returns {{ parallel: boolean, l1Drift: number, l2Drift: number }}
   */
  function getCrossLayerDrift() {
    const l1 = getGravityCenter({ layer: 'L1' });
    const l2 = getGravityCenter({ layer: 'L2' });
    const sameDirection = (l1.drift > 3 && l2.drift > 3) || (l1.drift < -3 && l2.drift < -3);
    return { parallel: sameDirection, l1Drift: l1.drift, l2Drift: l2.drift };
  }

  return {
    getGravityCenter,
    getGravityBias,
    getCrossLayerDrift,
    reset: () => {}
  };
  },
});
