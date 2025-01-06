// Clean minimal code, with direct & clear naming & structure, avoiding distracting comments & empty lines. Global scope used where possible for cleaner simplicity.
require('./utils');
class MeasureComposer {
  setMeter() {
    const { MIN: nMin, MAX: nMax, WEIGHTS: nWeights } = NUMERATOR;
    const { MIN: dMin, MAX: dMax, WEIGHTS: dWeights } = DENOMINATOR;
    return {  meter: [  randomWeightedSelection(nMin, nMax, nWeights),
      randomWeightedSelection(dMin, dMax, dWeights)  ]  };
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
    const note = this.composeRawNote();
    const composedNote = t.Note.midi(`${note}${this.setOctave()}`);
    if (composedNote === null) throw new Error(`Invalid note composed: ${note}${this.setOctave()}`);
    return composedNote;
  }
  composeChord() {
    const { MIN, MAX, WEIGHTS } = VOICES;
    const voices = randomWeightedSelection(MIN, MAX, WEIGHTS);
    const uniqueNotes = new Set();
    return Array(voices).fill().map(() => {
      let note; do {  note = this.composeNote();
      } while (uniqueNotes.has(note));
      uniqueNotes.add(note);
      return { note };
    });
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
  composeRawNote = () => this.notes[randomInt(this.notes.length)];
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
  composeRawNote() {
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
  p(c,
    { type: 'control_c', values: [channelLeft, 8, 0] },
    { type: 'control_c', values: [channelRight, 8, 127] },
    { type: 'control_c', values: [channelLeftInverted, 8, 0] },
    { type: 'control_c', values: [channelRightInverted, 8, 127] },
    { type: 'pitch_bend_c', values: [channelCenter, tuningPitchBend] }
  );
  totalMeasures = randomInt(MEASURES.MIN, MEASURES.MAX);
  for (measureIndex = 0; measureIndex < totalMeasures; measureIndex++) {
    randomComposer = randomInt(COMPOSERS.length);
    composers = (function() {  return COMPOSERS.map(composer => 
      eval(`(function() { return ${composer.return}; }).call({name: '${composer.name || ''}', root: '${composer.root || ''}', progression: ${JSON.stringify(composer.progression || [])}})`)  );  })();
    composer = composers[randomComposer];
    measure = composer.setMeter();
    [numerator, denominator] = measure.meter;
    ({ midiMeter, bpmFactor } = midiCompatibleMeter(numerator, denominator));
    midiBPM = BPM * bpmFactor;
    ticksPerMeasure = PPQ * 4 * (midiMeter[0] / midiMeter[1]);
    ticksPerBeat = ticksPerMeasure / numerator;
    p(c,
      { tick: currentTick, type: 'meter', values: [midiMeter[0], midiMeter[1]] },
      { tick: currentTick, type: 'bpm', values: [midiBPM] }
      );
    c.push(logUnit('measure'));
    for (beatIndex = 0; beatIndex < numerator; beatIndex++) {
      beatStartTick = currentTick + beatIndex * ticksPerBeat;
      divisionsPerBeat = Math.ceil(composer.setDivisions() * ((numerator / denominator) < 1 ? (numerator / denominator) : 1 / (numerator / denominator)));
      ticksPerDivision = ticksPerBeat / Math.max(1, divisionsPerBeat);
      binauralFreqOffset = randomFloat(BINAURAL.MIN, BINAURAL.MAX);
      c.push(logUnit('beat'));
      for (divisionIndex = 0; divisionIndex < divisionsPerBeat; divisionIndex++) {
        divisionStartTick = beatStartTick + divisionIndex * ticksPerDivision;
        const { MIN, MAX, WEIGHTS } = SUBDIVS;
        subdivsPerDiv = randomWeightedSelection(MIN, MAX, WEIGHTS);
        ticksPerSubdiv = ticksPerDivision / Math.max(1, subdivsPerDiv);
        c.push(logUnit('division'));
        if (Math.random() > 0.5) {
          invertBinaural = false;
          p(c,
            { tick: divisionStartTick, type: 'pitch_bend_c', values: [channelLeft, binauralPitchBendPlus] },
            { tick: divisionStartTick, type: 'pitch_bend_c', values: [channelRight, binauralPitchBendMinus] }
          );
        } else {
          invertBinaural = true;
          p(c,
            { tick: divisionStartTick, type: 'pitch_bend_c', values: [channelLeftInverted, binauralPitchBendMinus] },
            { tick: divisionStartTick, type: 'pitch_bend_c', values: [channelRightInverted, binauralPitchBendPlus] }
          );
        }
        for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
          subdivStartTick = divisionStartTick + subdivIndex * ticksPerSubdiv;
          c.push(logUnit('subdivision'));
          notes = composer.composeChord();
          notes.forEach(({ note }) => {
            useSubdiv = variate(Math.random() > 0.2, [-.3,.3], (.3));
            sustain = useSubdiv ? randomFloat(Math.max(ticksPerDivision * .5, ticksPerDivision / subdivsPerDiv), (ticksPerBeat * (.3 + Math.random() * .7))) : randomFloat(ticksPerDivision * .8, (ticksPerBeat * (.3 + Math.random() * .7)));
            onTick = subdivStartTick + Math.random() * sustain * 0.07;
            offTick = subdivStartTick + variate(sustain * randomFloat(.3, 4), [0.1, 0.2], [-.05, -0.1], 0.1);
            p(c,
              { tick: onTick, type: 'note_on_c', values: [channelCenter, note, velocity + (randomFloat(-.05,.05) * velocity)] },
              { tick: offTick + sustain * randomFloat(-.05, .05), values: [channelCenter, note] }
            );
            const randomVelocity = variate(velocity * randomFloat(.33, .44));
            if (invertBinaural === false) {
              p(c,
                { tick: onTick, type: 'note_on_c', values: [channelLeft, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)] },
                { tick: offTick + sustain * randomFloat(-.02, .02), values: [channelLeft, note] },
                { tick: onTick, type: 'note_on_c', values: [channelRight, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)] },
                { tick: offTick + sustain * randomFloat(-.02, .02), values: [channelRight, note] }
              );
            } else {
              p(c,
                { tick: onTick, type: 'note_on_c', values: [channelLeftInverted, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)] },
                { tick: offTick + sustain * randomFloat(-.02, .02), values: [channelLeftInverted, note] },
                { tick: onTick, type: 'note_on_c', values: [channelRightInverted, note, randomVelocity + (randomFloat(-.05,.05) * randomVelocity)] },
                { tick: offTick + sustain * randomFloat(-.02, .02), values: [channelRightInverted, note] }
              );
            }
          });
        }
      }
    }
    currentTick += ticksPerMeasure;  currentTime += secondsPerMeasure;
  }
  c = c.filter(item => item !== null).sort((a, b) => a.tick - b.tick);  c.forEach(_ => {
    composition += `1, ${_.tick || 0}, ${_.type || 'note_off_c'}, ${_.values.join(', ')}\n`;
    finalTick = _.tick;
  });
  composition += finale();
  fs.writeFileSync('output.csv', composition);
  console.log('output.csv created. Track Length:', formatTime(currentTime + SILENT_OUTRO_SECONDS));
})();
