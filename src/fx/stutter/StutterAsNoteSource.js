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
    if (!baseNote || !Number.isFinite(Number(baseNote.note))) {
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

    // Validate options
    if (!Number.isFinite(Number(pitchVariation)) || pitchVariation < 0) throw new Error('StutterAsNoteSource.generate: invalid pitchVariation');
    if (!Array.isArray(velocityRange) || velocityRange.length !== 2 || !Number.isFinite(Number(velocityRange[0])) || !Number.isFinite(Number(velocityRange[1]))) throw new Error('StutterAsNoteSource.generate: velocityRange must be [min,max] numbers');
    if (!Number.isFinite(Number(rhythmicJitter)) || rhythmicJitter < 0) throw new Error('StutterAsNoteSource.generate: rhythmicJitter must be >= 0');
    if (!Number.isFinite(Number(minNoteDuration)) || !Number.isFinite(Number(maxNoteDuration)) || minNoteDuration <= 0 || maxNoteDuration <= 0 || minNoteDuration > maxNoteDuration) throw new Error('StutterAsNoteSource.generate: invalid min/max note durations');
    if (!Number.isFinite(Number(octaveShiftProb)) || octaveShiftProb < 0 || octaveShiftProb > 1) throw new Error('StutterAsNoteSource.generate: octaveShiftProb must be 0-1');

    const numNotes = Math.max(1, Math.floor(density * 8 + rf(-2, 2))); // Density → note count (min 1)
    const notes = [];
    let currentTick = 0;
    const ticksPerNote = duration / numNotes;

    // Base velocity fallback uses nullish/coercion guard to preserve 0 if intentionally provided
    const baseVelocity = Number.isFinite(Number(baseNote.velocity)) ? Number(baseNote.velocity) : 80;

    for (let i = 0; i < numNotes; i++) {
      // Pitch variation: map density to interval spread
      const pitchOffset = Math.floor(rf(-pitchVariation * density, pitchVariation * density));
      let newNote = Number(baseNote.note) + pitchOffset;

      // Occasional octave shifts at high density
      if (density > 0.6 && rf() < octaveShiftProb) {
        newNote += (rf() < 0.5 ? -12 : 12);
      }

      newNote = clamp(newNote, 0, 127); // MIDI range

      // Velocity variation: stutter intensity → velocity scaling
      const velocityScale = rf(Number(velocityRange[0]), Number(velocityRange[1]));
      const newVelocity = clamp(
        Math.floor(baseVelocity * velocityScale * (0.5 + density * 0.5)),
        1,
        127
      );

      // Duration: higher density → shorter notes
      const noteDuration = clamp(
        Math.floor(rf(Number(minNoteDuration), Number(maxNoteDuration)) / (1 + density)),
        Number(minNoteDuration),
        Number(maxNoteDuration)
      );

      // Timing: rhythmic jitter based on density
      const jitter = rf(-rhythmicJitter * ticksPerNote, rhythmicJitter * ticksPerNote);
      const startTick = Math.max(0, Math.floor(currentTick + jitter));

      if (!Number.isFinite(startTick)) throw new Error('StutterAsNoteSource.generate: computed startTick is invalid');

      notes.push({
        note: Math.floor(newNote),
        velocity: Math.floor(newVelocity),
        duration: Math.floor(noteDuration),
        startTick
      });

      currentTick += ticksPerNote;
    }

    // Record generation for history
    generationHistory.push({
      baseNote: Number(baseNote.note),
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
    if (!stutterParams || !Number.isFinite(Number(stutterParams.numStutters))) {
      throw new Error('StutterAsNoteSource.fromStutterParams: stutterParams.numStutters must be a finite number');
    }

    const numStutters = Number(stutterParams.numStutters);
    const duration = Number.isFinite(Number(stutterParams.duration)) ? Number(stutterParams.duration) : tpSec;

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
    if (!stutterState || typeof stutterState !== 'object') return [];

    const { lastNote, density = 0.5, duration = tpSec * 0.5 } = stutterState;
    if (!lastNote) return []; // No last note available

    // Accept either numeric lastNote or object { note, velocity }
    let baseNote = null;
    if (Number.isFinite(Number(lastNote))) {
      baseNote = { note: Number(lastNote), velocity: 80 };
    } else if (typeof lastNote === 'object' && Number.isFinite(Number(lastNote.note))) {
      baseNote = lastNote;
    } else {
      return [];
    }

    if (typeof density !== 'number' || !Number.isFinite(density) || density < 0 || density > 1) return [];
    if (density < 0.3) return [];

    const dur = Number.isFinite(Number(duration)) ? Number(duration) : tpSec * 0.5;
    const notes = generate(baseNote, density, dur, options);

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
