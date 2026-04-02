// musicalTimeWindows.js - converts musical duration (seconds) to tick counts.
// Modules use this instead of hardcoded window sizes so that windows always
// cover the same musical duration regardless of tick rate or tempo changes.

musicalTimeWindows = (() => {

  function beatsForSeconds(seconds) {
    const beat = Number.isFinite(spBeat) && spBeat > 0 ? spBeat : 0.5;
    return m.max(2, m.round(seconds / beat));
  }

  function ticksForSeconds(seconds) {
    // Conductor recorders tick once per L1 measure (not per beat).
    // One measure = numerator beats. So ticks/second = 1 / (spBeat * numerator).
    const num = Number.isFinite(numerator) && numerator > 0 ? numerator : 4;
    const beat = Number.isFinite(spBeat) && spBeat > 0 ? spBeat : 0.5;
    const measureDuration = beat * num;
    return m.max(1, m.round(seconds / measureDuration));
  }

  return { beatsForSeconds, ticksForSeconds };
})();
