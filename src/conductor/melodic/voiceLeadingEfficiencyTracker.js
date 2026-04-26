// src/conductor/voiceLeadingEfficiencyTracker.js - Voice-leading smoothness tracker.
// Measures total semitone displacement between successive chord tones across layers.
// Smooth voice leading (minimal movement) - higher efficiency score.
// Pure query API - density bias to allow resolution time when choppy.

moduleLifecycle.declare({
  name: 'voiceLeadingEfficiencyTracker',
  subsystem: 'conductor',
  deps: [],
  provides: ['voiceLeadingEfficiencyTracker'],
  init: () => {
  const WINDOW_SECONDS = 6;

  /**
   * Compute voice-leading efficiency from recent note pairs.
   * @returns {{ efficiency: number, avgDisplacement: number, densityBias: number }}
   */
  function voiceLeadingEfficiencyTrackerComputeEfficiencySignal() {
    const notes = L0.query(L0_CHANNELS.note, { windowSeconds: WINDOW_SECONDS });

    if (notes.length < 4) {
      return { efficiency: 0.5, avgDisplacement: 3, densityBias: 1 };
    }
    const midis = analysisHelpers.extractMidiArray(notes, -1);

    // Group notes by approximate onset time (within 0.05s = "same beat")
    /** @type {number[][]} */
    const chords = [];
    /** @type {number[]} */
    let currentChord = [];
    let lastTime = -Infinity;

    for (let i = 0; i < notes.length; i++) {
      const t = (typeof notes[i].time === 'number') ? notes[i].time : 0;
      const midi = midis[i];
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

    // Density bias: choppy voice leading (low efficiency) - slight density reduction
    // to give room for smoother transitions
    let densityBias = 1;
    if (efficiency < 0.3) {
      densityBias = 0.94;
    } else if (efficiency > 0.8) {
      densityBias = 1.04; // smooth leading can handle denser textures
    }

    return { efficiency, avgDisplacement, densityBias };
  }

  const voiceLeadingEfficiencyTrackerCache = beatCache.create(voiceLeadingEfficiencyTrackerComputeEfficiencySignal);

  /**
   * Compute voice-leading efficiency from recent note pairs (cached per beat).
   * @returns {{ efficiency: number, avgDisplacement: number, densityBias: number }}
   */
  function getEfficiencySignal() { return voiceLeadingEfficiencyTrackerCache.get(); }

  /**
   * Get density multiplier for the targetDensity chain.
   * @returns {number}
   */
  function getDensityBias() {
    return getEfficiencySignal().densityBias;
  }

  // R22 E3: Tension bias from voice-leading efficiency.
  // Smooth voice leading (high efficiency) sustains higher tension levels;
  // choppy, large-displacement voice leading (low efficiency) calls for
  // resolution - lower tension to give the texture room to settle.
  // R25 E2: Graduated continuous ramp replaces binary thresholds.
  // Old: eff < 0.25 -> 0.94, eff > 0.75 -> 1.06, else 1.0 (dead zone).
  // New: linear ramp from 0.94 at eff=0 to 1.06 at eff=1.0. This
  // eliminates the 0.25-0.75 dead zone where the module was neutral,
  // ensuring every beat gets some voice-leading tension influence.
  /**
   * Get tension multiplier from voice-leading efficiency.
   * @returns {number}
   */
  function getTensionBias() {
    const s = getEfficiencySignal();
    return 0.94 + s.efficiency * 0.12;
  }

  conductorIntelligence.registerDensityBias('voiceLeadingEfficiencyTracker', () => voiceLeadingEfficiencyTracker.getDensityBias(), 0.9, 1.1);
  conductorIntelligence.registerTensionBias('voiceLeadingEfficiencyTracker', () => voiceLeadingEfficiencyTracker.getTensionBias(), 0.94, 1.06);

  // R31 E3: Flicker modifier from voice-leading efficiency.
  // Smooth voice leading (high efficiency) -> lower flicker (less rhythmic agitation).
  // Choppy voice leading (low efficiency) -> higher flicker (more rhythmic energy).
  // Continuous ramp: efficiency 0->1.05, efficiency 0.5->1.0, efficiency 1->0.95.
  function getFlickerModifier() {
    const s = getEfficiencySignal();
    return 1.05 - s.efficiency * 0.10;
  }

  conductorIntelligence.registerFlickerModifier('voiceLeadingEfficiencyTracker', () => voiceLeadingEfficiencyTracker.getFlickerModifier(), 0.95, 1.05);

  conductorIntelligence.registerStateProvider('voiceLeadingEfficiencyTracker', () => {
    const s = voiceLeadingEfficiencyTracker.getEfficiencySignal();
    return { voiceLeadingEfficiency: s ? s.efficiency : 0.5 };
  });

  function reset() {}
  conductorIntelligence.registerModule('voiceLeadingEfficiencyTracker', { reset }, ['section']);

  return {
    getEfficiencySignal,
    getDensityBias,
    getTensionBias,
    getFlickerModifier
  };
  },
});
