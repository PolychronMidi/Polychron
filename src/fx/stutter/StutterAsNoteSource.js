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
      octaveShiftProb = 0.2,        // Probability of octave shift per note
      octaveOnly = false,
      maxOctaveShift = 2,
      noteMin = 0,
      noteMax = 127,
      minIntervalSemitones = 2,
      minGeneratedNotes = 1,
      maxGeneratedNotes = 8
    } = options;

    // Validate options
    if (!Number.isFinite(Number(pitchVariation)) || pitchVariation < 0) throw new Error('StutterAsNoteSource.generate: invalid pitchVariation');
    if (!Array.isArray(velocityRange) || velocityRange.length !== 2 || !Number.isFinite(Number(velocityRange[0])) || !Number.isFinite(Number(velocityRange[1]))) throw new Error('StutterAsNoteSource.generate: velocityRange must be [min,max] numbers');
    if (!Number.isFinite(Number(rhythmicJitter)) || rhythmicJitter < 0) throw new Error('StutterAsNoteSource.generate: rhythmicJitter must be >= 0');
    if (!Number.isFinite(Number(minNoteDuration)) || !Number.isFinite(Number(maxNoteDuration)) || minNoteDuration <= 0 || maxNoteDuration <= 0 || minNoteDuration > maxNoteDuration) throw new Error('StutterAsNoteSource.generate: invalid min/max note durations');
    if (!Number.isFinite(Number(octaveShiftProb)) || octaveShiftProb < 0 || octaveShiftProb > 1) throw new Error('StutterAsNoteSource.generate: octaveShiftProb must be 0-1');
    if (typeof octaveOnly !== 'boolean') throw new Error('StutterAsNoteSource.generate: octaveOnly must be boolean');
    if (!Number.isFinite(Number(maxOctaveShift)) || Number(maxOctaveShift) < 1) throw new Error('StutterAsNoteSource.generate: maxOctaveShift must be >= 1');
    if (!Number.isFinite(Number(noteMin)) || !Number.isFinite(Number(noteMax)) || Number(noteMin) < 0 || Number(noteMax) > 127 || Number(noteMin) > Number(noteMax)) {
      throw new Error('StutterAsNoteSource.generate: noteMin/noteMax must define a valid MIDI range within 0..127');
    }
    if (!Number.isFinite(Number(minIntervalSemitones)) || minIntervalSemitones < 0) throw new Error('StutterAsNoteSource.generate: minIntervalSemitones must be >= 0');
    if (!Number.isFinite(Number(minGeneratedNotes)) || Number(minGeneratedNotes) < 1) throw new Error('StutterAsNoteSource.generate: minGeneratedNotes must be >= 1');
    if (!Number.isFinite(Number(maxGeneratedNotes)) || maxGeneratedNotes < 1) throw new Error('StutterAsNoteSource.generate: maxGeneratedNotes must be >= 1');

    const rawCount = m.max(1, m.floor(density * 8 + rf(-2, 2)));
    const minCount = m.max(1, m.floor(Number(minGeneratedNotes)));
    const maxCount = m.max(minCount, m.floor(Number(maxGeneratedNotes)));
    const numNotes = m.min(maxCount, m.max(minCount, rawCount));
    const notes = [];
    let currentTick = 0;
    const ticksPerNote = duration / numNotes;
    let lastOctaveShift = null;
    const baseMidi = m.round(Number(baseNote.note));

    // Base velocity fallback uses nullish/coercion guard to preserve 0 if intentionally provided
    const baseVelocity = Number.isFinite(Number(baseNote.velocity)) ? Number(baseNote.velocity) : 80;

    for (let i = 0; i < numNotes; i++) {
      // Pitch variation: map density to interval spread
      let newNote = baseMidi;
      if (octaveOnly) {
        const octaveCandidates = [];
        const maxOct = m.max(1, m.floor(Number(maxOctaveShift)));
        for (let octaveMag = 1; octaveMag <= maxOct; octaveMag++) {
          const upShift = octaveMag * 12;
          const downShift = -octaveMag * 12;
          if (newNote + upShift <= Number(noteMax)) octaveCandidates.push(upShift);
          if (newNote + downShift >= Number(noteMin)) octaveCandidates.push(downShift);
        }

        if (octaveCandidates.length > 0) {
          const filteredCandidates = (lastOctaveShift !== null && octaveCandidates.length > 1)
            ? octaveCandidates.filter((shift) => shift !== lastOctaveShift)
            : octaveCandidates;
          const useCandidates = filteredCandidates.length > 0 ? filteredCandidates : octaveCandidates;
          const pickedShift = useCandidates[ri(useCandidates.length - 1)];
          newNote += pickedShift;
          lastOctaveShift = pickedShift;
        } else {
          lastOctaveShift = 0;
        }

        const shiftSemitones = m.round(newNote - baseMidi);
        if (shiftSemitones !== 0 && m.abs(shiftSemitones % 12) !== 0) {
          throw new Error(`StutterAsNoteSource.generate: octaveOnly produced non-octave shift (${shiftSemitones})`);
        }
      } else {
        const pitchOffset = m.floor(rf(-pitchVariation * density, pitchVariation * density));
        newNote += pitchOffset;
        const octaveChance = clamp(Number(octaveShiftProb) + density * 0.15, 0, 1);
        if (rf() < octaveChance) {
          newNote += (rf() < 0.5 ? -12 : 12);
        }
      }

      if (!octaveOnly && notes.length > 0) {
        const previousNote = notes[notes.length - 1].note;
        if (m.abs(newNote - previousNote) < Number(minIntervalSemitones)) {
          const upward = previousNote + Number(minIntervalSemitones);
          const downward = previousNote - Number(minIntervalSemitones);
          if (upward <= 127) {
            newNote = upward;
          } else if (downward >= 0) {
            newNote = downward;
          } else {
            newNote = previousNote + (previousNote < 64 ? 12 : -12);
          }
        }
      }

      newNote = clamp(newNote, Number(noteMin), Number(noteMax)); // constrained MIDI range

      // Velocity variation: stutter intensity → velocity scaling
      const velocityScale = rf(Number(velocityRange[0]), Number(velocityRange[1]));
      const newVelocity = clamp(
        m.floor(baseVelocity * velocityScale * (0.5 + density * 0.5)),
        1,
        127
      );

      // Duration: higher density → shorter notes
      const noteDuration = clamp(
        m.floor(rf(Number(minNoteDuration), Number(maxNoteDuration)) / (1 + density)),
        Number(minNoteDuration),
        Number(maxNoteDuration)
      );

      // Timing: rhythmic jitter based on density
      const jitter = rf(-rhythmicJitter * ticksPerNote, rhythmicJitter * ticksPerNote);
      const startTick = m.max(0, m.floor(currentTick + jitter));

      if (!Number.isFinite(startTick)) throw new Error('StutterAsNoteSource.generate: computed startTick is invalid');

      notes.push({
        note: m.floor(newNote),
        velocity: m.floor(newVelocity),
        duration: m.floor(noteDuration),
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
    return generationHistory.slice(-m.min(limit, MAX_HISTORY));
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
