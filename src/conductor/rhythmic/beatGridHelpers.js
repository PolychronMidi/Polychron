// src/conductor/rhythmic/beatGridHelpers.js - Shared beat-grid utility.
// Used by AccentPatternTracker, SyncopationDensityTracker.
// Pure query — reads timing globals.

beatGridHelpers = (() => {
  /**
   * Get the current beat duration in seconds.
   * @returns {number} - beat duration in seconds (fallback: 0.5s)
   */
  function getBeatDuration() {
    if (typeof tpSec !== 'undefined' && typeof tpBeat !== 'undefined'
      && Number.isFinite(tpSec) && Number.isFinite(tpBeat) && tpSec > 0) {
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

  return { getBeatDuration, getBeatPosition };
})();
