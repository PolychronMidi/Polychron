u = require('./utils');
class MeasureComposer {
  constructor() {}
  setMeter() {
    const { MIN: nMin, MAX: nMax, WEIGHTS: nWeights } = NUMERATOR;
    const { MIN: dMin, MAX: dMax, WEIGHTS: dWeights } = DENOMINATOR;
    return {
      meter: [
        randomWeightedSelection(nMin, nMax, nWeights),
        randomWeightedSelection(dMin, dMax, dWeights)
      ]
    };
  }
  setOctave() {
    const { MIN, MAX, WEIGHTS } = OCTAVE;
    return randomWeightedSelection(MIN, MAX, WEIGHTS);
  }
  setDivisions() {
    const { MIN, MAX, WEIGHTS } = DIVISIONS;
    return randomWeightedSelection(MIN, MAX, WEIGHTS);
  }
  composeNote() {
    const rawNote = this.composeRawNote();
    const octave = this.setOctave();
    const composedNote = t.Note.midi(`${rawNote}${octave}`);
    if (composedNote === null) {
      throw new Error(`Invalid note composed: ${rawNote}${octave}`);
    }
    return composedNote;
  }
  composeChord() {
    const { MIN, MAX, WEIGHTS } = VOICES;
    const voices = randomWeightedSelection(MIN, MAX, WEIGHTS);
    const uniqueNotes = new Set();
    const composedChord = [];
    while (uniqueNotes.size < voices) {
      const note = this.composeNote();
      if (uniqueNotes.add(note)) {
        composedChord.push({ note });
      }
    }
    return composedChord;
  }
}
class ScaleComposer extends MeasureComposer {
  constructor(scaleName, root) {
    super();
    this.setScale(scaleName, root);
  }
  setScale(scaleName, root) {
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }
  composeRawNote() {
    return this.notes[randomInt(this.notes.length)];
  }
}
class RandomScaleComposer extends ScaleComposer {
  constructor() {
    super('', '');
    this.scales = t.Scale.names();
    this.randomScale();
  }
  randomScale() {
    const randomScale = allScales[randomInt(allScales.length)];
    const randomRoot = allNotes[randomInt(allNotes.length)];
    this.setScale(randomScale, randomRoot);
  }
  composeRawNote(measure) {
    this.randomScale();
    return super.composeRawNote();
  }
}
class ChordComposer extends MeasureComposer {
  constructor(progression) {
    super();
    this.setProgression(progression);
  }
  setProgression(progression) {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!allChords.includes(chordSymbol)) {
        console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;
      }
      return true;
    });
    this.progression = validatedProgression.map(t.Chord.get);
    this.currentChordIndex = 0;
  }
  composeRawNote() {
    const chord = this.progression[this.currentChordIndex];
    const noteIndex = randomInt(chord.notes.length);
    this.currentChordIndex = (this.currentChordIndex + 1) % (this.progression.length - 1);
    return chord.notes[noteIndex];
  }
}
class RandomChordComposer extends ChordComposer {
  constructor() {
    super([]);
    this.randomProgression();
  }
  randomProgression() {
    const progressionLength = randomInt(3, 8);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = allChords[randomInt(allChords.length)];
      randomProgression.push(randomChord);
    }
    this.setProgression(randomProgression);
  }
  composeRawNote() {
    this.randomProgression();
    return super.composeRawNote();
  }
}
(function csvMaestro() {
  c.push({
    type: 'control_c',
    values: [channelLeft, 8, 0]
  });
  c.push({
    type: 'control_c',
    values: [channelRight, 8, 127]
  });
  c.push({
    type: 'control_c',
    values: [channelLeftInverted, 8, 0]
  });
  c.push({
    type: 'control_c',
    values: [channelRightInverted, 8, 127]
  });
  c.push({
    type: 'pitch_bend_c',
    values: [channelCenter, tuningPitchBend]
  });
  totalMeasures = randomInt(MEASURES.MIN, MEASURES.MAX);
  for (measureIndex = 0; measureIndex < totalMeasures; measureIndex++) {
    randomComposer = randomInt(COMPOSERS.length);
    composers = (function(s) {  return COMPOSERS.map(composer => 
      eval(`(function(s) { return ${composer.return}; }).call({name: '${composer.name || ''}', root: '${composer.root || ''}', progression: ${JSON.stringify(composer.progression || [])}}, s)`)  );  })(s);
    composer = composers[randomComposer];
    measure = composer.setMeter();
    [numerator, denominator] = measure.meter;
    ({ midiMeter, tempoFactor } = midiCompatibleMeter(numerator, denominator));
    spoofedTempo = BASE_TEMPO * tempoFactor;
    ticksPerSecond = spoofedTempo * PPQ / 60;
    ticksPerMeasure = PPQ * 4 * (midiMeter[0] / midiMeter[1]);
    ticksPerBeat = ticksPerMeasure / numerator;
    secondsPerMeasure = ticksPerMeasure / ticksPerSecond;
    secondsPerBeat = ticksPerBeat / ticksPerSecond;
    c.push({
      startTick: currentTick,
      type: 'meter',
      values: [midiMeter[0], midiMeter[1]]
    });
    c.push({
      startTick: currentTick,
      type: 'bpm',
      values: [spoofedTempo]
    });
    binauralFreqOffset = randomFloat(BINAURAL.MIN, BINAURAL.MAX);
    centsToOffsetPlus = 1200 * Math.log2((TUNING_FREQ + binauralFreqOffset) / TUNING_FREQ);
    centsToOffsetMinus = 1200 * Math.log2((TUNING_FREQ - binauralFreqOffset) / TUNING_FREQ);
    binauralPitchBendPlus = Math.round(tuningPitchBend + (semitone * (centsToOffsetPlus / 100)));
    binauralPitchBendMinus = Math.round(tuningPitchBend + (semitone * (centsToOffsetMinus / 100)));
    if (Math.random() > 0.5) {
      invertBinaural = false;
      c.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelLeft, binauralPitchBendPlus]
      });
      c.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelRight, binauralPitchBendMinus]
      });
    } else {
      invertBinaural = true;
      c.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelLeftInverted, binauralPitchBendMinus]
      });
      c.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelRightInverted, binauralPitchBendPlus]
      });
    }
    c.push(logUnit('measure'));
    for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
      beatStartTick = currentTick + beatIndex * ticksPerBeat;
      beatStartTime = currentTime + beatIndex * secondsPerBeat;
      divisionsPerBeat = Math.ceil(composer.setDivisions() * ((numerator / denominator) < 1 ? (numerator / denominator) : 1 / (numerator / denominator)));
      ticksPerDivision = ticksPerBeat / divisionsPerBeat;
      secondsPerDivision = secondsPerBeat / divisionsPerBeat;
      c.push(logUnit('beat'));
      for (divisionIndex = 0; divisionIndex < divisionsPerBeat; divisionIndex++) {
        divisionStartTick = beatStartTick + divisionIndex * ticksPerDivision;
        divisionStartTime = beatStartTime + divisionIndex * secondsPerDivision;
        c.push(logUnit('division'));
        notes = composer.composeChord();
        notes.forEach(({ note }) => {
          noteOffTick = divisionStartTick + ticksPerDivision * randomFloat(.3, 4);
          c.push({
            startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
            type: 'note_on_c',
            values: [channelCenter, note, velocity + (randomFloat(-.05,.05) * velocity)]
          });
          c.push({
            startTick: noteOffTick + ticksPerDivision * randomFloat(-.05, .05),
            values: [channelCenter, note]
          });
          randomVelocity = velocity * randomFloat(.33,.4);
          if (invertBinaural = false) {
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelLeft, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * randomFloat(-.05, .05),
              values: [channelLeft, note]
            });
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelRight, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * randomFloat(-.05, .05),
              values: [channelRight, note]
            });
          } else {
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelLeftInverted, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * randomFloat(-.05, .05),
              values: [channelLeftInverted, note]
            });
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelRightInverted, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * randomFloat(-.05, .05),
              values: [channelRightInverted, note]
            });
          }
        });
      }
    }
    currentTick += ticksPerMeasure;  currentTime += secondsPerMeasure;
  }
  c = c.filter(item => item !== null);
  c.sort((a, b) => a.startTick - b.startTick);
  c.forEach(_ => {
    if (_.type === 'marker_t') {
      composition += `1, ${_.startTick}, marker_t, ${_.values.join(' ')}\n`;
    } else {
      composition += `1, ${_.startTick || 0}, ${_.type || 'note_off_c'}, ${_.values.join(', ')}\n`;
    }
    trackEndTick = Math.max(_.startTick + ticksPerSecond * SILENT_OUTRO_SECONDS);
  });
  composition += `1, ${trackEndTick}, end_track\n`;
  fs.writeFileSync('output.csv', composition);
  console.log('output.csv created. Track Length:', formatTime(currentTime + SILENT_OUTRO_SECONDS));
})();
