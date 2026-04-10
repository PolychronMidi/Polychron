// src/conductor/orchestrationWeightTracker.js - Register-band activity distribution.
// Measures how musical weight is distributed across bass/mid/treble bands
// and signals imbalance for the conductor to correct via register nudges.
// Pure query API - consumed via conductorState.

orchestrationWeightTracker = (() => {
  const WINDOW_SECONDS = 6;
  // Register band boundaries (MIDI note numbers)
  const BASS_CEIL = 55;     // up to G3
  const MID_CEIL = 72;      // up to C5
  // Above MID_CEIL = treble

  /**
   * Analyze orchestration weight across register bands.
   * @returns {{ bassWeight: number, midWeight: number, trebleWeight: number, suggestion: string, dominantBand: string }}
   */
  function getWeightSignal() {
    const notes = L0.query(L0_CHANNELS.note, { windowSeconds: WINDOW_SECONDS });

    if (notes.length < 3) {
      return { bassWeight: 0.33, midWeight: 0.34, trebleWeight: 0.33, suggestion: 'balanced', dominantBand: 'none' };
    }

    const midis = analysisHelpers.extractMidiArray(notes).filter((midi) => midi >= 0);

    let bass = 0;
    let mid = 0;
    let treble = 0;
    let total = 0;

    for (let i = 0; i < midis.length; i++) {
      const midi = midis[i];
      total++;
      if (midi <= BASS_CEIL) bass++;
      else if (midi <= MID_CEIL) mid++;
      else treble++;
    }

    if (total === 0) {
      return { bassWeight: 0.33, midWeight: 0.34, trebleWeight: 0.33, suggestion: 'balanced', dominantBand: 'none' };
    }

    const bassWeight = bass / total;
    const midWeight = mid / total;
    const trebleWeight = treble / total;

    // Determine dominant band and suggestion
    let dominantBand = 'none';
    let suggestion = 'balanced';

    const idealWeight = 1 / 3;
    const maxDeviation = m.max(
      m.abs(bassWeight - idealWeight),
      m.abs(midWeight - idealWeight),
      m.abs(trebleWeight - idealWeight)
    );

    if (maxDeviation > 0.25) {
      // Significant imbalance
      if (bassWeight > midWeight && bassWeight > trebleWeight) {
        dominantBand = 'bass';
        suggestion = 'lighten-bass';
      } else if (trebleWeight > midWeight && trebleWeight > bassWeight) {
        dominantBand = 'treble';
        suggestion = 'add-bass';
      } else {
        dominantBand = 'mid';
        suggestion = 'spread-registers';
      }
    } else if (maxDeviation > 0.15) {
      if (bassWeight < 0.15) suggestion = 'add-bass';
      else if (trebleWeight < 0.15) suggestion = 'add-treble';
      else suggestion = 'minor-adjustment';
      dominantBand = bassWeight > trebleWeight ? (bassWeight > midWeight ? 'bass' : 'mid') : (trebleWeight > midWeight ? 'treble' : 'mid');
    }

    return { bassWeight, midWeight, trebleWeight, suggestion, dominantBand };
  }

  conductorIntelligence.registerStateProvider('orchestrationWeightTracker', () => {
    const s = orchestrationWeightTracker.getWeightSignal();
    return {
      orchestrationSuggestion: s ? s.suggestion : 'balanced',
      orchestrationDominantBand: s ? s.dominantBand : 'none'
    };
  });

  function reset() {}
  conductorIntelligence.registerModule('orchestrationWeightTracker', { reset }, ['section']);

  return {
    getWeightSignal
  };
})();
