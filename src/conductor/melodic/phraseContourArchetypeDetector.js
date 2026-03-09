// src/conductor/phraseContourArchetypeDetector.js - Phrase contour classification.
// Classifies recent melodic contours into archetypes: arch, ramp, plateau,
// valley, zigzag. Signals contour type awareness and variety nudging.
// Pure query API - consumed via conductorState.

phraseContourArchetypeDetector = (() => {
  const WINDOW_SECONDS = 6;

  /**
   * Classify the melodic contour archetype from recent notes.
   * @returns {{ archetype: string, confidence: number, suggestion: string }}
   */
  function getContourSignal() {
    const notes = absoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS });

    if (notes.length < 5) {
      return { archetype: 'undefined', confidence: 0, suggestion: 'maintain' };
    }

    // Extract MIDI pitches
    const pitches = analysisHelpers.extractMidiArray(notes).filter((midi) => midi >= 0);

    if (pitches.length < 5) {
      return { archetype: 'undefined', confidence: 0, suggestion: 'maintain' };
    }

    // Split into halves
    const half = m.floor(pitches.length / 2);
    let firstHalfSum = 0;
    let secondHalfSum = 0;
    for (let i = 0; i < half; i++) firstHalfSum += pitches[i];
    for (let i = half; i < pitches.length; i++) secondHalfSum += pitches[i];
    const firstAvg = firstHalfSum / half;
    const secondAvg = secondHalfSum / (pitches.length - half);

    // Find peak and valley positions
    let peakIdx = 0;
    let valleyIdx = 0;
    for (let i = 0; i < pitches.length; i++) {
      if (pitches[i] > pitches[peakIdx]) peakIdx = i;
      if (pitches[i] < pitches[valleyIdx]) valleyIdx = i;
    }
    const peakPos = peakIdx / (pitches.length - 1);
    const valleyPos = valleyIdx / (pitches.length - 1);

    // Count direction changes
    let dirChanges = 0;
    for (let i = 2; i < pitches.length; i++) {
      const prev = pitches[i - 1] - pitches[i - 2];
      const curr = pitches[i] - pitches[i - 1];
      if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) dirChanges++;
    }
    const zigzagRatio = dirChanges / (pitches.length - 2);

    // Overall direction
    const overallDiff = secondAvg - firstAvg;
    const range = pitches[peakIdx] - pitches[valleyIdx];

    // Classify
    let archetype = 'neutral';
    let confidence = 0.5;

    if (zigzagRatio > 0.65) {
      archetype = 'zigzag';
      confidence = clamp(zigzagRatio, 0.5, 1);
    } else if (peakPos > 0.25 && peakPos < 0.75 && range > 4) {
      archetype = 'arch';
      confidence = clamp(1 - m.abs(peakPos - 0.5) * 3, 0.4, 1);
    } else if (valleyPos > 0.25 && valleyPos < 0.75 && range > 4) {
      archetype = 'valley';
      confidence = clamp(1 - m.abs(valleyPos - 0.5) * 3, 0.4, 1);
    } else if (overallDiff > 3) {
      archetype = 'ramp-up';
      confidence = clamp(overallDiff / 10, 0.4, 1);
    } else if (overallDiff < -3) {
      archetype = 'ramp-down';
      confidence = clamp(-overallDiff / 10, 0.4, 1);
    } else if (range < 5) {
      archetype = 'plateau';
      confidence = clamp(1 - range / 8, 0.3, 1);
    }

    // Suggestion based on archetype variety desire
    let suggestion = 'maintain';
    if (confidence > 0.8 && archetype !== 'neutral') {
      suggestion = 'vary-contour';
    }

    return { archetype, confidence, suggestion };
  }

  conductorIntelligence.registerStateProvider('phraseContourArchetypeDetector', () => {
    const s = phraseContourArchetypeDetector.getContourSignal();
    return {
      contourArchetype: s ? s.archetype : 'undefined',
      contourSuggestion: s ? s.suggestion : 'maintain'
    };
  });

  return {
    getContourSignal
  };
})();
