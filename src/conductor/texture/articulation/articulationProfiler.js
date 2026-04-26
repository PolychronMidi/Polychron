// src/conductor/articulationProfiler.js - Note-duration distribution analysis.
// Detects staccato-heavy vs legato-heavy texture; flags duration monotony.
// Pure query API - biases duration selection in motifConfig.

moduleLifecycle.declare({
  name: 'articulationProfiler',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['articulationProfiler'],
  init: (deps) => {
  const V = deps.validator.create('articulationProfiler');
  const query = analysisHelpers.createTrackerQuery(V, 4, { minNotes: 3 });
  // Duration thresholds relative to beat duration
  const STACCATO_RATIO = 0.25; // 25% of beat = staccato
  const LEGATO_RATIO = 0.75;   // 75% of beat = legato

  /**
   * Analyze note-duration distribution in recent notes.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ staccatoRatio: number, legatoRatio: number, avgDuration: number, monotonous: boolean, articulation: string }}
   */
  function getArticulationProfile(opts = {}) {
    const notes = query(opts);
    if (!notes) return { staccatoRatio: 0, legatoRatio: 0, avgDuration: 0, monotonous: false, articulation: 'unknown' };

    // Beat duration in seconds; fallback 0.5s
    const beatDur = beatGridHelpers.getBeatDuration();

    let staccatoCount = 0;
    let legatoCount = 0;
    let durSum = 0;

    for (let i = 0; i < notes.length; i++) {
      const dur = (typeof notes[i].duration === 'number' && Number.isFinite(notes[i].duration))
        ? notes[i].duration : beatDur * 0.5;
      durSum += dur;
      const ratio = dur / beatDur;
      if (ratio <= STACCATO_RATIO) staccatoCount++;
      else if (ratio >= LEGATO_RATIO) legatoCount++;
    }

    const total = notes.length;
    const staccatoRatio = staccatoCount / total;
    const legatoRatio = legatoCount / total;
    const avgDuration = durSum / total;

    // Monotonous if >80% falls into one category
    const monotonous = staccatoRatio > 0.8 || legatoRatio > 0.8;

    let articulation = 'mixed';
    if (staccatoRatio > 0.6) articulation = 'staccato-heavy';
    else if (legatoRatio > 0.6) articulation = 'legato-heavy';

    return { staccatoRatio, legatoRatio, avgDuration, monotonous, articulation };
  }

  /**
   * Get a duration selection bias to encourage articulation variety.
   * Staccato-heavy - boost legato; legato-heavy - boost staccato.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ legatoBias: number, staccatoBias: number }}
   */
  function getDurationBias(opts) {
    const profile = getArticulationProfile(opts);
    if (profile.articulation === 'staccato-heavy') {
      return { legatoBias: 1.3, staccatoBias: 0.8 };
    }
    if (profile.articulation === 'legato-heavy') {
      return { legatoBias: 0.8, staccatoBias: 1.25 };
    }
    return { legatoBias: 1.0, staccatoBias: 1.0 };
  }

  conductorIntelligence.registerStateProvider('articulationProfiler', () => {
    const b = articulationProfiler.getDurationBias();
    return {
      articulationLegatoBias: b ? b.legatoBias : 1,
      articulationStaccatoBias: b ? b.staccatoBias : 1
    };
  });

  function reset() {}
  conductorIntelligence.registerModule('articulationProfiler', { reset }, ['section']);

  return {
    getArticulationProfile,
    getDurationBias
  };
  },
});
