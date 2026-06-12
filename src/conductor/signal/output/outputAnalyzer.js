

/**
 * Output Analyzer - Post-Hoc Musical Coherence Analysis (E12)
 *
 * After composition completes (called from grandFinale), analyses the
 * MIDI output for structural properties:
 *   - Pitch class distribution & entropy
 *   - Interval histogram
 *   - Note density over time
 *   - Rhythmic regularity
 *
 * Results are appended to the system manifest as an 'outputAnalysis'
 * section. Pure post-hoc observation - no feedback into composition.
 */

moduleLifecycle.declare({
  name: 'outputAnalyzer',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['outputAnalyzer'],
  init: (deps) => {
  const V = deps.validator.create('outputAnalyzer');

  /**
   * Analyse an array of note events.
   * @param {{ pitch: number, startMs: number, durationMs: number, velocity: number }[]} notes
   * @returns {object} analysis results
   */
  function analyse(notes) {
    V.assertArray(notes, 'notes');
    if (notes.length === 0) return { noteCount: 0 };

    // Pitch-class distribution
    const pcCounts = new Array(12).fill(0);
    for (const n of notes) {
      const pc = n.pitch % 12;
      pcCounts[pc]++;
    }
    const total = notes.length;
    const pcDist = pcCounts.map(c => c / total);

    // Shannon entropy of pitch-class distribution
    let pcEntropy = 0;
    for (const p of pcDist) {
      if (p > 0) pcEntropy -= p * m.log2(p);
    }

    // Interval histogram
    const intervals = new Map();
    const sorted = [...notes].sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < sorted.length; i++) {
      const iv = m.abs(sorted[i].pitch - sorted[i - 1].pitch) % 12;
      intervals.set(iv, (intervals.get(iv) ?? 0) + 1);
    }

    // Temporal density (notes per second, windowed)
    const windowMs = 2000;
    const startMs  = sorted[0].startMs;
    const endMs    = sorted[sorted.length - 1].startMs;
    const span     = endMs - startMs;
    const bins     = m.max(1, m.ceil(span / windowMs));
    const densityCurve = new Array(bins).fill(0);
    for (const n of sorted) {
      const bin = m.min(bins - 1, m.floor((n.startMs - startMs) / windowMs));
      densityCurve[bin]++;
    }
    const avgDensity = total / m.max(1, span / 1000);

    // Rhythmic regularity (CV of inter-onset intervals)
    const iois = [];
    for (let i = 1; i < sorted.length; i++) {
      const dt = sorted[i].startMs - sorted[i - 1].startMs;
      if (dt > 0) iois.push(dt);
    }
    let ioiCV = 0;
    if (iois.length > 1) {
      const mean = iois.reduce((s, x) => s + x, 0) / iois.length;
      const variance = iois.reduce((s, x) => s + (x - mean) ** 2, 0) / iois.length;
      ioiCV = mean > 0 ? m.sqrt(variance) / mean : 0;
    }

    return {
      noteCount: total,
      pitchClassEntropy: Number(pcEntropy.toFixed(3)),
      pitchClassDistribution: pcDist.map(p => Number(p.toFixed(3))),
      intervalHistogram: Object.fromEntries(intervals),
      averageDensity: Number(avgDensity.toFixed(2)),
      densityBins: bins,
      rhythmicIrregularity: Number(ioiCV.toFixed(3)),
    };
  }

  function reset() { /* stateless */ }

  return { analyse, reset };
  },
});
