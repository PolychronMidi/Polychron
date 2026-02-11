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
  chanceOverride
) {
  const profiles = {
    source: {
      pitchVariation: 5,
      velocityRange: [0.5, 1.1],
      rhythmicJitter: 0.2,
      velScale: 0.7,
      defaultDensity: 0.5,
      chance: 0.3
    },
    reflection: {
      pitchVariation: 5,
      velocityRange: [0.5, 1.1],
      rhythmicJitter: 0.2,
      velScale: 0.7,
      defaultDensity: 0.5,
      chance: 0.3
    },
    bass: {
      pitchVariation: 3,
      velocityRange: [0.6, 1.0],
      rhythmicJitter: 0.15,
      velScale: 0.8,
      defaultDensity: 0.4,
      chance: 0.3
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

  const chanceRaw = typeof chanceOverride === 'number' ? chanceOverride : config.chance;
  const chance = clamp(chanceRaw, 0, 1);
  if (rf() >= chance) return;

  const baseDensity = typeof stutterProb === 'number' ? stutterProb : config.defaultDensity;
  const finalDensity = typeof densityOverride === 'number' ? densityOverride : baseDensity;
  const clampedDensity = clamp(finalDensity, 0, 1);

  try {
    const stutterNotes = StutterAsNoteSource.generate(
      { note: baseNote, velocity, duration: sustain },
      clampedDensity,
      sustain,
      {
        pitchVariation: config.pitchVariation,
        velocityRange: config.velocityRange,
        rhythmicJitter: config.rhythmicJitter
      }
    );

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
