// Dependency: midiTiming is required via `src/time/index.js`
/**
 * Compute phrase alignment between L1 and L2 meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * @returns {void}
 */
getPolyrhythm = () => {
  if (!composer){
    console.warn('getPolyrhythm() called without valid composer');
    return false;
  }

  const MAX_ATTEMPTS = 100;
  let attempts = 0;
  while (attempts++ < MAX_ATTEMPTS) {
    [polyNumerator, polyDenominator] = composer.getMeter(true, true);
    if (!Number.isFinite(polyNumerator) || !Number.isFinite(polyDenominator) || polyDenominator <= 0) {
      continue;
    }
    polyMeterRatio = polyNumerator / polyDenominator;
    let allMatches = [];
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
          let currentMatch = {
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
      return true;
    }
  }
  // Max attempts reached: try new meter on L1 layer with relaxed constraints
  console.warn(`Acceptable warning: getPolyrhythm() reached max attempts (${MAX_ATTEMPTS}); requesting new L1 meter...`);
  [numerator, denominator] = composer.getMeter(true, false);
  // Recalculate all timing after meter change to prevent sync desync
  getMidiTiming();
  getPolyrhythm();
  return true;
};
