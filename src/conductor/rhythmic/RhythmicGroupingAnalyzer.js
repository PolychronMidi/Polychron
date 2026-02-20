// src/conductor/RhythmicGroupingAnalyzer.js - Binary vs. ternary grouping detector.
// Analyzes recent onset patterns for binary (2+2) vs. ternary (3+3) grouping,
// providing signals for grouping type awareness and transition detection.
// Pure query API — consumed via ConductorState.

RhythmicGroupingAnalyzer = (() => {
  const WINDOW_SECONDS = 6;

  /**
   * Analyze rhythmic grouping from recent onset intervals.
   * @returns {{ groupingType: string, binaryScore: number, ternaryScore: number, inTransition: boolean }}
   */
  function getGroupingSignal() {
    const entries = AbsoluteTimeWindow.getEntries(WINDOW_SECONDS);

    if (entries.length < 6) {
      return { groupingType: 'ambiguous', binaryScore: 0.5, ternaryScore: 0.5, inTransition: false };
    }

    const iois = beatGridHelpers.getRecentIOIs(entries);

    if (iois.length < 4) {
      return { groupingType: 'ambiguous', binaryScore: 0.5, ternaryScore: 0.5, inTransition: false };
    }

    // Find median IOI as the "beat unit"
    const sorted = iois.slice().sort((a, b) => a - b);
    const medianIOI = sorted[m.floor(sorted.length / 2)];
    if (medianIOI <= 0) {
      return { groupingType: 'ambiguous', binaryScore: 0.5, ternaryScore: 0.5, inTransition: false };
    }

    // Score how well IOIs fit binary (multiples of 2) vs. ternary (multiples of 3)
    let binaryFit = 0;
    let ternaryFit = 0;

    for (let i = 0; i < iois.length; i++) {
      const ratio = iois[i] / medianIOI;
      // Binary: ratio close to 0.5, 1, 2, 4
      const binaryDist = m.min(
        m.abs(ratio - 0.5),
        m.abs(ratio - 1),
        m.abs(ratio - 2),
        m.abs(ratio - 4)
      );
      // Ternary: ratio close to 1/3, 2/3, 1, 3
      const ternaryDist = m.min(
        m.abs(ratio - 1 / 3),
        m.abs(ratio - 2 / 3),
        m.abs(ratio - 1),
        m.abs(ratio - 3)
      );
      binaryFit += m.max(0, 1 - binaryDist * 3);
      ternaryFit += m.max(0, 1 - ternaryDist * 3);
    }

    const total = binaryFit + ternaryFit;
    const binaryScore = total > 0 ? binaryFit / total : 0.5;
    const ternaryScore = total > 0 ? ternaryFit / total : 0.5;

    // Detect transition: first half vs. second half grouping differs
    const halfIdx = m.floor(iois.length / 2);
    let firstHalfBinary = 0;
    let secondHalfBinary = 0;
    for (let i = 0; i < halfIdx; i++) {
      const ratio = iois[i] / medianIOI;
      firstHalfBinary += m.abs(ratio - m.round(ratio * 2) / 2) < 0.2 ? 1 : 0;
    }
    for (let i = halfIdx; i < iois.length; i++) {
      const ratio = iois[i] / medianIOI;
      secondHalfBinary += m.abs(ratio - m.round(ratio * 2) / 2) < 0.2 ? 1 : 0;
    }
    const firstPct = halfIdx > 0 ? firstHalfBinary / halfIdx : 0.5;
    const secondPct = (iois.length - halfIdx) > 0 ? secondHalfBinary / (iois.length - halfIdx) : 0.5;
    const inTransition = m.abs(firstPct - secondPct) > 0.4;

    let groupingType = 'ambiguous';
    if (binaryScore > 0.65) groupingType = 'binary';
    else if (ternaryScore > 0.65) groupingType = 'ternary';

    return { groupingType, binaryScore, ternaryScore, inTransition };
  }

  ConductorIntelligence.registerStateProvider('RhythmicGroupingAnalyzer', () => {
    const s = RhythmicGroupingAnalyzer.getGroupingSignal();
    return {
      rhythmicGroupingType: s ? s.groupingType : 'ambiguous',
      rhythmicGroupingInTransition: s ? s.inTransition : false
    };
  });

  return {
    getGroupingSignal
  };
})();
