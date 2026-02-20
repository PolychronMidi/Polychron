// src/conductor/rhythmic/beatGridHelpers.js - Shared beat-grid utility.
// Used by AccentPatternTracker, SyncopationDensityTracker, InterLayerRhythmAnalyzer,
// ArticulationProfiler, DurationalContourTracker, RhythmicSymmetryDetector,
// RhythmicGroupingAnalyzer, OnsetRegularityMonitor.
// Pure query — reads timing globals.

beatGridHelpers = (() => {
  /**
   * Get the current beat duration in seconds.
   * @returns {number} - beat duration in seconds (fallback: 0.5s)
   */
  function getBeatDuration() {
    if (Number.isFinite(tpSec) && Number.isFinite(tpBeat) && tpSec > 0) {
      return tpBeat / tpSec;
    }
    return 0.5;
  }

  /**
   * Get the metric position (0-1) of a time within the current beat grid.
   * @param {number} time - absolute time in seconds
   * @returns {number} - 0 to 1 position within beat
   */
  function getBeatPosition(time) {
    const dur = getBeatDuration();
    return (time % dur) / dur;
  }

  /**
   * Extract inter-onset intervals from an array of entries/notes with .time.
   * Sorts by time, filters positive gaps.
   * @param {Array<{ time: number }>} entries
   * @returns {number[]} - array of positive IOI durations
   */
  function getRecentIOIs(entries) {
    const onsets = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i] && typeof entries[i].time === 'number') {
        onsets.push(entries[i].time);
      }
    }
    onsets.sort((a, b) => a - b);
    const iois = [];
    for (let i = 1; i < onsets.length; i++) {
      const gap = onsets[i] - onsets[i - 1];
      if (gap > 0) iois.push(gap);
    }
    return iois;
  }

  return { getBeatDuration, getBeatPosition, getRecentIOIs };
})();
