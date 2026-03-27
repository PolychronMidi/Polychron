// src/conductor/intervalDirectionMemory.js - Interval+direction overuse tracker.
// Remembers which interval/direction pairs (e.g., "+3", "-5") have been
// heavily used recently, providing freshness signals and avoidance hints.
// Pure query API - consumed via conductorState.

intervalDirectionMemory = (() => {
  const WINDOW_SECONDS = 8;

  /**
   * Analyze interval+direction usage and detect overuse.
   * @returns {{ overusedIntervals: string[], freshness: number, suggestion: string }}
   */
  function getFreshnessSignal() {
    const notes = L0.query('note', { windowSeconds: WINDOW_SECONDS });

    if (notes.length < 5) {
      return { overusedIntervals: [], freshness: 1, suggestion: 'maintain' };
    }
    const midis = analysisHelpers.extractMidiArray(notes, -1);

    // Build interval+direction histogram
    /** @type {Object.<string, number>} */
    const histogram = {};
    let totalIntervals = 0;

    for (let i = 1; i < midis.length; i++) {
      const prev = midis[i - 1];
      const curr = midis[i];
      if (prev < 0 || curr < 0) continue;
      const diff = curr - prev;
      if (diff === 0) continue; // skip unisons
      const key = (diff > 0 ? '+' : '') + String(diff);
      histogram[key] = (histogram[key] || 0) + 1;
      totalIntervals++;
    }

    if (totalIntervals < 3) {
      return { overusedIntervals: [], freshness: 1, suggestion: 'maintain' };
    }

    // Find overused intervals (>25% of all intervals)
    const threshold = totalIntervals * 0.25;
    /** @type {string[]} */
    const overused = [];
    const keys = Object.keys(histogram);

    for (let i = 0; i < keys.length; i++) {
      if (histogram[keys[i]] > threshold) {
        overused.push(keys[i]);
      }
    }

    // Freshness: variety of interval types used
    const uniqueIntervals = keys.length;
    const maxExpected = m.min(totalIntervals, 10);
    const freshness = clamp(uniqueIntervals / maxExpected, 0, 1);

    let suggestion = 'maintain';
    if (overused.length > 0 && freshness < 0.4) suggestion = 'avoid-' + overused[0];
    else if (freshness < 0.3) suggestion = 'seek-variety';
    else if (freshness > 0.8) suggestion = 'fresh';

    return { overusedIntervals: overused, freshness, suggestion };
  }

  conductorIntelligence.registerStateProvider('intervalDirectionMemory', () => {
    const s = intervalDirectionMemory.getFreshnessSignal();
    return {
      intervalFreshness: s ? s.freshness : 1,
      intervalFreshnessSuggestion: s ? s.suggestion : 'maintain'
    };
  });

  return {
    getFreshnessSignal
  };
})();
