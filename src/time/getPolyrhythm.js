/* global composer, numerator, denominator, polyNumerator, polyDenominator, polyMeterRatio, meterRatio, m, measuresPerPhrase1, measuresPerPhrase2, getMidiTiming, warnOnce */
/**
 * Compute phrase alignment between primary and poly meters in seconds.
 * Sets: measuresPerPhrase1, measuresPerPhrase2.
 * @returns {void}
 */
const getPolyrhythm = () => {
  if (!composer) return;
  // For quick local runs (PLAY_LIMIT), avoid expensive getMeter loops and fall back to 1:1 phrasing
  if (process.env && process.env.PLAY_LIMIT) {
    // Minimal safe defaults for bounded play runs. Only apply defaults when caller
    // hasn't explicitly provided polyNumerator/polyDenominator (allow tests to set them).
    if (typeof polyNumerator === 'undefined' || typeof polyDenominator === 'undefined') {
      polyNumerator = numerator;
      polyDenominator = denominator;
    }
    polyMeterRatio = polyNumerator / polyDenominator;
    // In PLAY_LIMIT mode, prefer simple 1:1 phrasing to avoid complex polyrhythm loops
    measuresPerPhrase1 = 1;
    measuresPerPhrase2 = 1;
    return;
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

    // If meters are identical, phrasing is trivially 1:1
    if (numerator === polyNumerator && denominator === polyDenominator) {
      measuresPerPhrase1 = 1;
      measuresPerPhrase2 = 1;
      return;
    }

    if (bestMatch.totalMeasures !== Infinity &&
        (bestMatch.totalMeasures > 2 &&
         (bestMatch.primaryMeasures > 1 || bestMatch.polyMeasures > 1))) {
      measuresPerPhrase1 = bestMatch.primaryMeasures;
      measuresPerPhrase2 = bestMatch.polyMeasures;
      return;
    }
  }
  // Max attempts reached: try new meter on primary layer with relaxed constraints
  console.warn(`getPolyrhythm() reached max attempts (${MAX_ATTEMPTS}); requesting new primary meter...`);
  [numerator, denominator] = composer.getMeter(true, false);
  // CRITICAL: Recalculate all timing after meter change to prevent sync desync
  getMidiTiming();
  // As a last resort, fall back to 1:1 phrasing to allow play to proceed while logging a warning
  try { warnOnce('polyrhythm:relaxed', 'getPolyrhythm relaxed to 1:1 phrasing after max attempts'); } catch (e) { /* swallow if warnOnce not present */ }
  measuresPerPhrase1 = 1;
  measuresPerPhrase2 = 1;
};

module.exports = getPolyrhythm;
