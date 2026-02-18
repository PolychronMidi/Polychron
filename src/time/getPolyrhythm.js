// getPolyrhythm.js - Compute phrase alignment between L1 and L2 meters in seconds
/**
 * Compute phrase alignment between L1 and L2 meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * @returns {void}
 */
getPolyrhythm = () => {
  if (typeof LM === 'undefined' || !LM || typeof LM.getComposerFor !== 'function') {
    throw new Error('getPolyrhythm: LayerManager.getComposerFor not available');
  }
  const activeComposer = LM.getComposerFor('L1');

  const MAX_ATTEMPTS = 100;
  let attempts = 0;
  while (attempts++ < MAX_ATTEMPTS) {
    [polyNumerator, polyDenominator] = activeComposer.getMeter(true, true);
    if (!Number.isFinite(polyNumerator) || !Number.isFinite(polyDenominator) || polyDenominator <= 0) {
      continue;
    }
    polyMeterRatio = polyNumerator / polyDenominator;
    const allMatches = [];
    let bestMatch = {
      primaryMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity,
      polyNumerator: polyNumerator,
      polyDenominator: polyDenominator
    };

    for (let primaryMeasures = 1; primaryMeasures < 7; primaryMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 7; polyMeasures++) {
        if (m.abs(primaryMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
          const currentMatch = {
            primaryMeasures: primaryMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: primaryMeasures + polyMeasures,
            polyNumerator: polyNumerator,
            polyDenominator: polyDenominator
          };
          allMatches.push(currentMatch);
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }
    if (bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1))) {
      measuresPerPhrase1 = bestMatch.primaryMeasures;
      measuresPerPhrase2 = bestMatch.polyMeasures;
      return;
    }
  }
  // Max attempts reached: try new meter on L1 layer with relaxed constraints
  console.warn(`Acceptable warning: getPolyrhythm() reached max attempts (${MAX_ATTEMPTS}); requesting new L1 meter...`);
  [numerator, denominator] = activeComposer.getMeter(true, false);
  // Recalculate all timing after meter change to prevent sync desync
  getMidiTiming();
  getPolyrhythm();
  return;
};
