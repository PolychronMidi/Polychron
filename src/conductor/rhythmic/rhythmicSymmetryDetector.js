// src/conductor/rhythmicSymmetryDetector.js - Palindromic / augmentation / diminution patterns.
// Scans recent onset patterns for structural symmetry (palindromes,
// proportional augmentation/diminution). Signals emerging symmetry
// vs. when asymmetry should keep things fresh.
// Pure query API - no side effects.

rhythmicSymmetryDetector = (() => {
  const WINDOW_SECONDS = 6;
  const MIN_ONSETS = 4;

  /**
   * Extract inter-onset intervals from recent rhythm entries.
   * @returns {number[]}
   */
  function getRecentIOIs() {
    const entries = absoluteTimeWindow.getEntries(WINDOW_SECONDS);
    if (entries.length < MIN_ONSETS) return [];
    const rawIOIs = beatGridHelpers.getRecentIOIs(entries);
    // Quantize to hundredths for symmetry comparison
    const iois = [];
    for (let i = 0; i < rawIOIs.length; i++) iois.push(m.round(rawIOIs[i] * 100) / 100);
    return iois;
  }

  /**
   * Measure palindromic similarity (0-1) of an IOI sequence.
   * @param {number[]} iois
   * @returns {number}
   */
  function palindromeScore(iois) {
    if (iois.length < 3) return 0;
    let matches = 0;
    const halfLen = m.floor(iois.length / 2);
    for (let i = 0; i < halfLen; i++) {
      const a = iois[i];
      const b = iois[iois.length - 1 - i];
      // Allow 15% tolerance for near-palindromes
      if (m.abs(a - b) <= m.max(a, b) * 0.15) matches++;
    }
    return matches / halfLen;
  }

  /**
   * Detect augmentation/diminution (constant ratio between consecutive IOIs).
   * @param {number[]} iois
   * @returns {number} 0-1 metric of proportional consistency
   */
  function augmentationScore(iois) {
    if (iois.length < 3) return 0;
    /** @type {number[]} */
    const ratios = [];
    for (let i = 1; i < iois.length; i++) {
      if (iois[i - 1] > 0) ratios.push(iois[i] / iois[i - 1]);
    }
    if (ratios.length < 2) return 0;

    // Measure consistency of ratios
    let sum = 0;
    for (let i = 0; i < ratios.length; i++) sum += ratios[i];
    const mean = sum / ratios.length;

    let variance = 0;
    for (let i = 0; i < ratios.length; i++) {
      variance += (ratios[i] - mean) * (ratios[i] - mean);
    }
    variance /= ratios.length;

    // Low variance + ratio != 1 - augmentation/diminution detected
    const consistency = m.max(0, 1 - m.sqrt(variance) * 2);
    const isTransformative = m.abs(mean - 1) > 0.1 ? 1 : 0.3;
    return consistency * isTransformative;
  }

  /**
   * Get the composite symmetry signal.
   * @returns {{ symmetryScore: number, type: string, suggestion: string }}
   */
  function getSymmetrySignal() {
    const iois = getRecentIOIs();
    if (iois.length < MIN_ONSETS - 1) {
      return { symmetryScore: 0, type: 'none', suggestion: 'maintain' };
    }

    const palScore = palindromeScore(iois);
    const augScore = augmentationScore(iois);
    const symmetryScore = m.max(palScore, augScore);

    let type = 'none';
    if (palScore > augScore && palScore > 0.4) type = 'palindrome';
    else if (augScore > 0.4) type = 'augmentation';

    // If symmetry is high, might want to break it for freshness
    // If symmetry is low, emerging symmetry could be aesthetically interesting
    let suggestion = 'maintain';
    if (symmetryScore > 0.7) suggestion = 'break-symmetry';
    else if (symmetryScore > 0.4) suggestion = 'developing';
    else suggestion = 'seek-pattern';

    return { symmetryScore, type, suggestion };
  }

  conductorIntelligence.registerStateProvider('rhythmicSymmetryDetector', () => {
    const s = rhythmicSymmetryDetector.getSymmetrySignal();
    return {
      symmetryType: s ? s.type : 'none',
      symmetrySuggestion: s ? s.suggestion : 'maintain'
    };
  });

  return {
    getSymmetrySignal
  };
})();
