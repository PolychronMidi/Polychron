// src/time/getMeterPair.js
// Replaces composer.getMeter() + getPolyrhythm() with a single table-driven pick.
// First call in a section: picks a pair with length in [2, 3].
// Subsequent calls: picks a pair within 10% of the previous pair's length.
// Sets numerator/denominator (L1) and polyNumerator/polyDenominator/polyMeterRatio/measuresPerPhrase1/measuresPerPhrase2.

moduleLifecycle.declare({
  name: 'getMeterPair',
  subsystem: 'time',
  deps: [],
  provides: ['getMeterPair'],
  init: () => {
  const FIRST_LO = 2;
  const FIRST_HI = 3;
  const DRIFT = 0.1;

  let getMeterPairLastLength = null;

  function pick() {
    const lo = getMeterPairLastLength === null ? FIRST_LO : getMeterPairLastLength * (1 - DRIFT);
    const hi = getMeterPairLastLength === null ? FIRST_HI : getMeterPairLastLength * (1 + DRIFT);

    let pool = [];
    for (let i = 0; i < POLYRHYTHM_PAIRS.length; i++) {
      const p = POLYRHYTHM_PAIRS[i];
      if (p.length >= lo && p.length <= hi) pool.push(p);
    }

    if (pool.length === 0) {
      // Fallback: pick the pair with the closest length to the midpoint
      const target = (getMeterPairLastLength === null ? (FIRST_LO + FIRST_HI) / 2 : getMeterPairLastLength);
      let best = POLYRHYTHM_PAIRS[0];
      let bestDist = m.abs(best.length - target);
      for (let i = 1; i < POLYRHYTHM_PAIRS.length; i++) {
        const d = m.abs(POLYRHYTHM_PAIRS[i].length - target);
        if (d < bestDist) { best = POLYRHYTHM_PAIRS[i]; bestDist = d; }
      }
      pool = [best];
    }

    const p = pool[m.floor(m.random() * pool.length)];
    getMeterPairLastLength = p.length;

    numerator = p.n1;
    denominator = p.d1;
    polyNumerator = p.n2;
    polyDenominator = p.d2;
    polyMeterRatio = p.n2 / p.d2;
    measuresPerPhrase1 = p.pm1;
    measuresPerPhrase2 = p.pm2;
  }

  function reset() {
    getMeterPairLastLength = null;
  }

  return { pick, reset };
  },
});
