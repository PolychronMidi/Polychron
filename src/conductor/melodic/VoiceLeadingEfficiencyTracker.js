// src/conductor/VoiceLeadingEfficiencyTracker.js - Voice-leading smoothness tracker.
// Measures total semitone displacement between successive chord tones across layers.
// Smooth voice leading (minimal movement) → higher efficiency score.
// Pure query API — density bias to allow resolution time when choppy.

VoiceLeadingEfficiencyTracker = (() => {
  const WINDOW_SECONDS = 6;

  /**
   * Compute voice-leading efficiency from recent note pairs.
   * @returns {{ efficiency: number, avgDisplacement: number, densityBias: number }}
   */
  function getEfficiencySignal() {
    const notes = AbsoluteTimeWindow.getNotes({ windowSeconds: WINDOW_SECONDS });

    if (notes.length < 4) {
      return { efficiency: 0.5, avgDisplacement: 3, densityBias: 1 };
    }

    // Group notes by approximate onset time (within 0.05s = "same beat")
    /** @type {number[][]} */
    const chords = [];
    /** @type {number[]} */
    let currentChord = [];
    let lastTime = -Infinity;

    for (let i = 0; i < notes.length; i++) {
      const t = (typeof notes[i].time === 'number') ? notes[i].time : 0;
      const midi = (typeof notes[i].midi === 'number') ? notes[i].midi : -1;
      if (midi < 0) continue;

      if (t - lastTime > 0.05 && currentChord.length > 0) {
        chords.push(currentChord);
        currentChord = [];
      }
      currentChord.push(midi);
      lastTime = t;
    }
    if (currentChord.length > 0) chords.push(currentChord);

    if (chords.length < 2) {
      return { efficiency: 0.5, avgDisplacement: 3, densityBias: 1 };
    }

    // Measure average minimum displacement between consecutive chords
    let totalDisplacement = 0;
    let pairs = 0;

    for (let c = 1; c < chords.length; c++) {
      const prev = chords[c - 1];
      const curr = chords[c];
      // For each note in curr, find closest in prev
      for (let j = 0; j < curr.length; j++) {
        let minDist = Infinity;
        for (let k = 0; k < prev.length; k++) {
          const dist = m.abs(curr[j] - prev[k]);
          if (dist < minDist) minDist = dist;
        }
        if (minDist < Infinity) {
          totalDisplacement += minDist;
          pairs++;
        }
      }
    }

    const avgDisplacement = pairs > 0 ? totalDisplacement / pairs : 3;
    // Efficiency: 0 displacement = perfect, >7 = poor
    const efficiency = clamp(1 - avgDisplacement / 7, 0, 1);

    // Density bias: choppy voice leading (low efficiency) → slight density reduction
    // to give room for smoother transitions
    let densityBias = 1;
    if (efficiency < 0.3) {
      densityBias = 0.94;
    } else if (efficiency > 0.8) {
      densityBias = 1.04; // smooth leading can handle denser textures
    }

    return { efficiency, avgDisplacement, densityBias };
  }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getEfficiencySignal().densityBias;
  }

  return {
    getEfficiencySignal,
    getDensityBias
  };
})();
