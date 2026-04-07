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
      const regime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'evolving');
      const regimeScale = regime === 'coherent' ? 0.4 : regime === 'exploring' ? 1.5 : 1.0;
      // CIM: coordinated = more tolerance (layers meant to overlap), independent = harder penalty
      const cimPenaltyScale = 1.3 - cimScale * 0.6;
      // Melodic coupling: intervalFreshness scales collision penalty.
      // Novel intervals -> collisions add exploratory dissonance -> reduce penalty.
      // Stale intervals -> collisions are muddy repetition -> increase penalty.
      const melodicCtxVIM = safePreBoot.call(() => emergentMelodicEngine.getContext(), null);
      const intervalFreshness = melodicCtxVIM ? V.optionalFinite(melodicCtxVIM.intervalFreshness, 0.5) : 0.5;
      const freshnessScale = 1.3 - intervalFreshness * 0.6; // [0.7 fresh ... 1.3 stale]

      // Rhythmic coupling: dense rhythm -> collisions statistically expected -> reduce penalty.
      const rhythmEntryVIM = L0.getLast('emergentRhythm', { layer: 'both' });
      const rhythmDensityVIM = rhythmEntryVIM && Number.isFinite(rhythmEntryVIM.density) ? rhythmEntryVIM.density : 0;
      const rhythmPenaltyMod = 1.0 - rhythmDensityVIM * 0.20; // [0.80-1.0] dense->less penalty
      // R84 E1: complexity bridge -- high rhythmic complexity raises collision penalty
      // (tighter vertical control during complex moments). Counterpart: dynamicRoleSwap
      // LOWERS swap gate under same signal (dynamics reshuffle during complexity).
      const rhythmComplexityVIM = rhythmEntryVIM && Number.isFinite(rhythmEntryVIM.complexity) ? rhythmEntryVIM.complexity : 0.5;
      const complexityPenaltyMod = 1.0 + clamp((rhythmComplexityVIM - 0.5) * 0.20, -0.05, 0.10);
      // R86 E1: biasStrength antagonism bridge -- confident rhythm pulse raises collision tolerance.
      // Counterpart: temporalGravity STRENGTHENS gravity wells under same signal (temporal cohesion + harmonic freedom).
      const biasStrengthVIM = rhythmEntryVIM && Number.isFinite(rhythmEntryVIM.biasStrength) ? rhythmEntryVIM.biasStrength : 0;
      const biasPenaltyMod = 1.0 - clamp((biasStrengthVIM - 0.3) * 0.15, 0, 0.10);
      return BASE_PROB_REDUCE * m.min(collisions, 3) * regimeScale * cimPenaltyScale * freshnessScale * rhythmPenaltyMod * complexityPenaltyMod * biasPenaltyMod;
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
