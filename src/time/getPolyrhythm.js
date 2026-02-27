// getPolyrhythm.js - Select L2 meter alignment using the pre-computed POLYRHYTHM_PAIRS table.
// Sets: polyNumerator, polyDenominator, polyMeterRatio, measuresPerPhrase1, measuresPerPhrase2.
/**
 * Pick a valid L2 meter alignment for the current L1 meter from POLYRHYTHM_PAIRS.
 * Eliminates the retry loop - every entry in the table is pre-validated.
 * Falls back to a new L1 meter only when no alignment exists for the current meter.
 * @returns {void}
 */
getPolyrhythm = () => {
  // Find all table entries whose first or second meter matches the current L1 meter.
  // Cross-multiply to compare ratios exactly without floating-point error.
  const candidates = [];
  for (let i = 0; i < POLYRHYTHM_PAIRS.length; i++) {
    const p = POLYRHYTHM_PAIRS[i];
    if (p.n1 * denominator === numerator * p.d1) {
      candidates.push({ polyN: p.n2, polyD: p.d2, pm1: p.pm1, pm2: p.pm2 });
    } else if (p.n2 * denominator === numerator * p.d2) {
      candidates.push({ polyN: p.n1, polyD: p.d1, pm1: p.pm2, pm2: p.pm1 });
    }
  }

  if (candidates.length === 0) {
    // No valid alignment for this L1 meter - request a new one and retry
    console.warn(`Acceptable warning: getPolyrhythm(): no alignment for ${numerator}/${denominator}; requesting new L1 meter...`);
    const activeComposer = LM.getComposerFor('L1');
    [numerator, denominator] = activeComposer.getMeter(true, false);
    getMidiTiming();
    getPolyrhythm();
    return;
  }

  const pick = candidates[m.floor(m.random() * candidates.length)];
  polyNumerator = pick.polyN;
  polyDenominator = pick.polyD;
  polyMeterRatio = polyNumerator / polyDenominator;
  measuresPerPhrase1 = pick.pm1;
  measuresPerPhrase2 = pick.pm2;
};
