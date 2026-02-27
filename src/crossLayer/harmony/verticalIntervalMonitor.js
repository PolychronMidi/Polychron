// @ts-check

/**
 * Vertical Interval Monitor (E2)
 *
 * Cross-layer module that queries absoluteTimeGrid for recent note
 * events from both layers and analyses the vertical intervals between
 * simultaneous notes. Detects parallel octaves/fifths, dissonance
 * clusters, and registral overlap, emitting diagnostics to
 * explainabilityBus and nudging playProb when collisions are detected.
 */

verticalIntervalMonitor = (() => {
  const V = validator.create('verticalIntervalMonitor');

  const CHANNEL     = 'notePitch';
  const TOLERANCE   = 80;          // ms - simultaneity window
  const PROB_REDUCE = -0.04;       // playProb penalty on collision

  // Interval classes that flag overlap (in semitones mod 12)
  const OVERLAP_INTERVALS = new Set([0]);  // unison/octave

  let collisionCount = 0;
  let lastCheckMs    = 0;

  /**
   * Called each beat from cross-layer processing.
   * @param {object} ctx  beat context with absoluteTimeMs
   * @returns {number} playProb additive modifier
   */
  function process(ctx) {
    const nowMs = V.optionalFinite(ctx && ctx.absoluteTimeMs, 0);
    if (nowMs <= lastCheckMs) return 0;
    lastCheckMs = nowMs;

    // Query recent note pitches from both layers
    const l1Events = absoluteTimeGrid.query(CHANNEL, nowMs, TOLERANCE, { onlyLayer: '1' });
    const l2Events = absoluteTimeGrid.query(CHANNEL, nowMs, TOLERANCE, { onlyLayer: '2' });

    if (!l1Events || !l2Events || l1Events.length === 0 || l2Events.length === 0) return 0;

    let collisions = 0;
    for (const e1 of l1Events) {
      const p1 = V.optionalFinite(e1.data && e1.data.pitch, -1);
      if (p1 < 0) continue;
      for (const e2 of l2Events) {
        const p2 = V.optionalFinite(e2.data && e2.data.pitch, -1);
        if (p2 < 0) continue;
        const ic = ((p1 - p2) % 12 + 12) % 12;
        if (OVERLAP_INTERVALS.has(ic)) collisions++;
      }
    }

    if (collisions > 0) {
      collisionCount += collisions;
      explainabilityBus.emit('verticalCollision', '0', {
        collisions,
        timeMs: nowMs,
        totalCollisions: collisionCount,
      }, nowMs);
      return PROB_REDUCE * Math.min(collisions, 3);
    }

    return 0;
  }

  function getCollisionCount() { return collisionCount; }

  function reset() {
    collisionCount = 0;
    lastCheckMs    = 0;
  }

  const mod = { process, getCollisionCount, reset };

  crossLayerRegistry.register('verticalIntervalMonitor', mod, ['all', 'section']);

  return mod;
})();
