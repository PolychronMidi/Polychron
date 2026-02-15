// src/fx/stutter/stutterNoteSourceScheduler.js - helper for stutter-derived note scheduling

scheduleStutterNotesFromDensity = function scheduleStutterNotesFromDensity(
  profile,
  channel,
  baseNote,
  velocity,
  onTick,
  sustain,
  stutterProb,
  densityOverride,
  chanceOverride,
  unitName
) {
  const profiles = {
    source: {
      pitchVariation: 0,
      velocityRange: [0.5, 1.1],
      rhythmicJitter: 0.2,
      velScale: 0.7,
      defaultDensity: 0.5,
      chance: 0.3,
      octaveShiftProb: 0.38,
      octaveOnly: true,
      maxOctaveShift: 4,
      minIntervalSemitones: 12,
      minGeneratedNotes: 2,
      maxGeneratedNotes: 4
    },
    reflection: {
      pitchVariation: 0,
      velocityRange: [0.5, 1.1],
      rhythmicJitter: 0.2,
      velScale: 0.7,
      defaultDensity: 0.5,
      chance: 0.3,
      octaveShiftProb: 0.34,
      octaveOnly: true,
      maxOctaveShift: 4,
      minIntervalSemitones: 12,
      minGeneratedNotes: 2,
      maxGeneratedNotes: 3
    },
    bass: {
      pitchVariation: 0,
      velocityRange: [0.6, 1.0],
      rhythmicJitter: 0.15,
      velScale: 0.8,
      defaultDensity: 0.4,
      chance: 0.3,
      octaveShiftProb: 0.42,
      octaveOnly: true,
      maxOctaveShift: 3,
      minIntervalSemitones: 12,
      minGeneratedNotes: 2,
      maxGeneratedNotes: 2
    }
  };

  const config = profiles[profile] || profiles.source;

  if (typeof StutterAsNoteSource === 'undefined') {
    throw new Error('scheduleStutterNotesFromDensity: StutterAsNoteSource not available');
  }
  if (typeof channel !== 'number') {
    throw new Error('scheduleStutterNotesFromDensity: channel must be a number');
  }
  if (typeof baseNote !== 'number') {
    throw new Error('scheduleStutterNotesFromDensity: baseNote must be a number');
  }
  if (typeof velocity !== 'number') {
    throw new Error('scheduleStutterNotesFromDensity: velocity must be a number');
  }
  if (typeof onTick !== 'number') {
    throw new Error('scheduleStutterNotesFromDensity: onTick must be a number');
  }
  if (typeof sustain !== 'number' || sustain <= 0) {
    throw new Error('scheduleStutterNotesFromDensity: sustain must be positive number');
  }

  const unitChanceScale = unitName === 'beat'
    ? 1
    : unitName === 'div'
      ? 0.6
      : unitName === 'subdiv'
        ? 0.35
        : 0.2;
  const chanceRaw = typeof chanceOverride === 'number' ? chanceOverride : config.chance;
  const chance = clamp(chanceRaw * unitChanceScale, 0, 1);
  if (rf() >= chance) return;

  const baseDensity = typeof stutterProb === 'number' ? stutterProb : config.defaultDensity;
  const finalDensity = typeof densityOverride === 'number' ? densityOverride : baseDensity;
  const clampedDensity = clamp(finalDensity, 0, 1);

  try {
    const configuredVoiceCap = (typeof VOICES !== 'undefined' && VOICES && Number.isFinite(Number(VOICES.max)))
      ? Number(VOICES.max)
      : 4;
    const maxGeneratedNotes = m.max(1, m.min(Number(config.maxGeneratedNotes || 2), configuredVoiceCap));

    const stutterNotes = StutterAsNoteSource.generate(
      { note: baseNote, velocity, duration: sustain },
      clampedDensity,
      sustain,
      {
        pitchVariation: config.pitchVariation,
        velocityRange: config.velocityRange,
        rhythmicJitter: config.rhythmicJitter,
        octaveShiftProb: config.octaveShiftProb,
        octaveOnly: Boolean(config.octaveOnly),
        maxOctaveShift: Number(config.maxOctaveShift || 2),
        noteMin: m.max(0, OCTAVE.min * 12 - 1),
        noteMax: profile === 'bass' ? 59 : (OCTAVE.max * 12 - 1),
        minIntervalSemitones: config.minIntervalSemitones,
        minGeneratedNotes: Number(config.minGeneratedNotes || 1),
        maxGeneratedNotes
      }
    );

    if (config.octaveOnly) {
      for (const generatedNote of stutterNotes) {
        const shiftSemitones = m.round(Number(generatedNote.note) - Number(baseNote));
        if (shiftSemitones !== 0 && m.abs(shiftSemitones % 12) !== 0) {
          throw new Error(`scheduleStutterNotesFromDensity: non-octave note generated in octaveOnly mode (base=${baseNote}, generated=${generatedNote.note}, shift=${shiftSemitones})`);
        }
      }
    }

    stutterNotes.forEach((generatedNote) => {
      const genOnTick = onTick + generatedNote.startTick;
      const genOffTick = genOnTick + generatedNote.duration;
      p(c, { tick: genOnTick, type: 'on', vals: [channel, generatedNote.note, generatedNote.velocity * config.velScale] });
      p(c, { tick: genOffTick, vals: [channel, generatedNote.note] });
    });
  } catch (e) {
    throw new Error(`scheduleStutterNotesFromDensity: failed to generate or schedule notes: ${e && e.message ? e.message : e}`);
  }
};
