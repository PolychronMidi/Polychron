// src/fx/stutter/StutterAsNoteSource.js - Generative stutters as compositional material
// Transforms stutter parameters (velocity, panning, delay) into pitch/rhythm variations
// Enables feedback loop: stutters → notes → future stutters

StutterAsNoteSource = (() => {
  let generationHistory = [];     // Track generated stutter-notes for analysis
  const MAX_HISTORY = 100;

  /**
   * Generate notes from stutter parameters
   * Maps stutter intensity/timing → pitch variations and rhythmic density
   * @param {Object} baseNote - Base note object { note, velocity, duration }
   * @param {number} density - Stutter density (0-1), higher = more notes
   * @param {number} duration - Total duration in ticks for stutter-note generation
   * @param {Object} options - Generation options
   * @returns {Array<{note:number, velocity:number, duration:number, startTick:number}>} Generated notes
   * @throws {Error} if baseNote or density invalid
   */
  function generate(baseNote, density, duration, options = {}) {
    if (!baseNote || typeof baseNote.note !== 'number') {
      throw new Error('StutterAsNoteSource.generate: baseNote must have numeric note property');
    }

    if (typeof density !== 'number' || !Number.isFinite(density) || density < 0 || density > 1) {
      throw new Error(`StutterAsNoteSource.generate: density must be 0-1, got ${density}`);
    }

    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      throw new Error(`StutterAsNoteSource.generate: duration must be positive, got ${duration}`);
    }

    const {
      pitchVariation = 7,           // Max semitone deviation from base note
      velocityRange = [0.4, 1.2],   // Velocity multiplier range
      rhythmicJitter = 0.15,        // Timing jitter (0-1)
      minNoteDuration = 48,         // Minimum note duration in ticks
      maxNoteDuration = 240,        // Maximum note duration in ticks
      octaveShiftProb = 0.2         // Probability of octave shift per note
    } = options;

    const numNotes = Math.max(1, Math.floor(density * 8 + rf(-2, 2))); // Density → note count
    const notes = [];
    let currentTick = 0;
    const ticksPerNote = duration / numNotes;

    for (let i = 0; i < numNotes; i++) {
      // Pitch variation: map density to interval spread
      const pitchOffset = Math.floor(rf(-pitchVariation * density, pitchVariation * density));
      let newNote = baseNote.note + pitchOffset;

      // Occasional octave shifts at high density
      if (density > 0.6 && rf() < octaveShiftProb) {
        newNote += (rf() < 0.5 ? -12 : 12);
      }

      newNote = clamp(newNote, 0, 127); // MIDI range

      // Velocity variation: stutter intensity → velocity scaling
      const velocityScale = rf(...velocityRange);
      const newVelocity = clamp(
        Math.floor((baseNote.velocity || 80) * velocityScale * (0.5 + density * 0.5)),
        1,
        127
      );

      // Duration: higher density → shorter notes
      const noteDuration = clamp(
        Math.floor(rf(minNoteDuration, maxNoteDuration) / (1 + density)),
        minNoteDuration,
        maxNoteDuration
      );

      // Timing: rhythmic jitter based on density
      const jitter = rf(-rhythmicJitter * ticksPerNote, rhythmicJitter * ticksPerNote);
      const startTick = Math.max(0, Math.floor(currentTick + jitter));

      notes.push({
        note: newNote,
        velocity: newVelocity,
        duration: noteDuration,
        startTick
      });

      currentTick += ticksPerNote;
    }

    // Record generation for history
    generationHistory.push({
      baseNote: baseNote.note,
      density,
      duration,
      generatedCount: notes.length,
    });

    if (generationHistory.length > MAX_HISTORY) {
      generationHistory.shift();
    }

    // Emit event for feedback loop
    if (typeof EventBus !== 'undefined') {
      try {
        EventBus.emit('stutter-notes-generated', {
          count: notes.length,
          density,
          duration
        });
      } catch (e) {
        throw new Error(`StutterAsNoteSource.generate: EventBus emit failed: ${e && e.message ? e.message : e}`);
      }
    }

    return notes;
  }

  /**
   * Generate stutter-notes from existing stutter effects applied to a channel
   * Reads stutter parameters (fade, pan, FX) and converts to pitch/rhythm
   * @param {Object} stutterParams - Stutter effect parameters { numStutters, duration, channels }
   * @param {Object} baseNote - Base note to derive variations from
   * @param {Object} options - Generation options
   * @returns {Array} Generated notes
   * @throws {Error} if stutterParams invalid
   */
  function fromStutterParams(stutterParams, baseNote, options = {}) {
    if (!stutterParams || typeof stutterParams.numStutters !== 'number') {
      throw new Error('StutterAsNoteSource.fromStutterParams: stutterParams must have numStutters');
    }

    const { numStutters, duration = tpSec } = stutterParams;

    // Map numStutters to density (normalize to 0-1)
    const density = clamp(numStutters / 100, 0, 1);

    return generate(baseNote, density, duration, options);
  }

  /**
   * Integrate stutter-generated notes into playNotes flow
   * Call this during beat-level note generation to inject stutter-derived material
   * @param {string} level - Note generation level ('beat', 'div', etc.)
   * @param {Object} stutterState - Current stutter state (from StutterManager)
   * @param {Object} options - Playback options
   * @returns {Array} Notes to play
   */
  function injectIntoPlayNotes(level, stutterState = {}, options = {}) {
    if (!stutterState || !stutterState.lastNote) {
      return []; // No stutter state available
    }

    const { lastNote, density = 0.5, duration = tpSec * 0.5 } = stutterState;

    // Generate stutter-notes only if density is high enough (avoid spamming)
    if (density < 0.3) return [];

    const notes = generate(lastNote, density, duration, options);

    return notes;
  }

  /**
   * Get generation history (for analysis/debugging)
   * @param {number} limit - Max records to return
   * @returns {Array}
   */
  function getHistory(limit = 50) {
    return generationHistory.slice(-Math.min(limit, MAX_HISTORY));
  }

  /**
   * Reset generation history
   */
  function reset() {
    generationHistory = [];
  }

  return {
    generate,
    fromStutterParams,
    injectIntoPlayNotes,
    getHistory,
    reset
  };
})();
