// src/time/getMeterPair.js
// Replaces composer.getMeter() + getPolyrhythm() with a single table-driven pick.
// First call in a section: picks a pair with length in [2, 3].
// Subsequent calls: picks a pair within ±10% of the previous pair's length.
// Sets numerator/denominator (L1) and polyNumerator/polyDenominator/polyMeterRatio/measuresPerPhrase1/measuresPerPhrase2.

getMeterPair = (() => {
  const FIRST_LO = 2;
  const FIRST_HI = 3;
  const DRIFT = 0.1;

  let _lastLength = null;

  function pick() {
    const lo = _lastLength === null ? FIRST_LO : _lastLength * (1 - DRIFT);
    const hi = _lastLength === null ? FIRST_HI : _lastLength * (1 + DRIFT);

    let pool = [];
    for (let i = 0; i < POLYRHYTHM_PAIRS.length; i++) {
      const p = POLYRHYTHM_PAIRS[i];
      if (p.length >= lo && p.length <= hi) pool.push(p);
    }

    if (pool.length === 0) {
      // Fallback: pick the pair with the closest length to the midpoint
      const target = (_lastLength === null ? (FIRST_LO + FIRST_HI) / 2 : _lastLength);
      let best = POLYRHYTHM_PAIRS[0];
      let bestDist = m.abs(best.length - target);
      for (let i = 1; i < POLYRHYTHM_PAIRS.length; i++) {
        const d = m.abs(POLYRHYTHM_PAIRS[i].length - target);
        if (d < bestDist) { best = POLYRHYTHM_PAIRS[i]; bestDist = d; }
      }
      pool = [best];
    }

    const p = pool[m.floor(m.random() * pool.length)];
    _lastLength = p.length;

    numerator = p.n1;
    denominator = p.d1;
    polyNumerator = p.n2;
    polyDenominator = p.d2;
    polyMeterRatio = p.n2 / p.d2;
    measuresPerPhrase1 = p.pm1;
    measuresPerPhrase2 = p.pm2;
  }

  function reset() {
    _lastLength = null;
  }

  return { pick, reset };
})();
