// src/crossLayer/harmony/verticalIntervalMonitor.js
// Cross-layer vertical interval analysis. Detects unison/octave collisions
// between simultaneous notes in L1/L2, posts collision data to L0 for
// harmonicIntervalGuard and spectralComplementarity, and returns a playProb
// penalty proportional to collision severity. Regime-responsive: coherent
// tolerates more unisons (voices unify), exploring penalizes harder.

verticalIntervalMonitor = (() => {
  const V = validator.create('verticalIntervalMonitor');

  const TOLERANCE   = 80;          // ms simultaneity window
  const BASE_PROB_REDUCE = -0.04;
  const OVERLAP_INTERVALS = new Set([0]);  // unison/octave

  let collisionCount = 0;
  let lastCheckSec   = 0;
  let recentCollisionRate = 0;
  let cimScale = 0.5;

  function process(absoluteSeconds, layer) {
    const nowSec = V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    if (nowSec <= lastCheckSec) return 0;
    lastCheckSec = nowSec;

    const l1Events = L0.query('note', { aroundSeconds: nowSec, toleranceSec: TOLERANCE / 1000, layer: 'L1' });
    const l2Events = L0.query('note', { aroundSeconds: nowSec, toleranceSec: TOLERANCE / 1000, layer: 'L2' });

    if (!l1Events.length || !l2Events.length) return 0;

    let collisions = 0;
    for (const e1 of l1Events) {
      const p1 = V.optionalFinite(e1.midi, -1);
      if (p1 < 0) continue;
      for (const e2 of l2Events) {
        const p2 = V.optionalFinite(e2.midi, -1);
        if (p2 < 0) continue;
        const ic = ((p1 - p2) % 12 + 12) % 12;
        if (OVERLAP_INTERVALS.has(ic)) collisions++;
      }
    }

    // EMA for downstream consumers
    recentCollisionRate += (m.min(collisions, 3) / 3 - recentCollisionRate) * 0.15;

    if (collisions > 0) {
      collisionCount += collisions;

      // Post to L0 so harmonicIntervalGuard and spectralComplementarity can react
      L0.post('verticalCollision', layer || 'both', nowSec, {
        collisions, totalCollisions: collisionCount, collisionRate: recentCollisionRate
      });

      // Regime-responsive penalty: coherent tolerates unisons, exploring penalizes
      const profSnap = safePreBoot.call(() => systemDynamicsProfiler.getSnapshot(), null);
      const regime = profSnap && profSnap.regime ? profSnap.regime : 'evolving';
      const regimeScale = regime === 'coherent' ? 0.4 : regime === 'exploring' ? 1.5 : 1.0;
      // CIM: coordinated = more tolerance (layers meant to overlap), independent = harder penalty
      const cimPenaltyScale = 1.3 - cimScale * 0.6;

      return BASE_PROB_REDUCE * m.min(collisions, 3) * regimeScale * cimPenaltyScale;
    }

    return 0;
  }

  function getCollisionCount() { return collisionCount; }
  function getCollisionRate()  { return recentCollisionRate; }
  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  function reset() {
    collisionCount = 0;
    lastCheckSec   = 0;
    recentCollisionRate = 0;
    cimScale = 0.5;
  }

  crossLayerRegistry.register('verticalIntervalMonitor', { reset }, ['all', 'section']);

  return { process, getCollisionCount, getCollisionRate, setCoordinationScale, reset };
})();
