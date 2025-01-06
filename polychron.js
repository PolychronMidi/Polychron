// Clean minimal code, with direct & clear naming & structure, avoiding distracting comments & empty lines. Global scope used where possible for cleaner simplicity.
require('./stage');
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
      beatStart = currentTick + beatIndex * ticksPerBeat;
      divsPerBeat = Math.ceil(composer.setDivisions() * ((numerator / denominator) < 1 ? (numerator / denominator) : 1 / (numerator / denominator)));
      ticksPerDiv = ticksPerBeat / Math.max(1, divsPerBeat);
        if (beatCount % beatsUntilBinauralShift === 0) {
          binauralFreqOffset = randomFloat(Math.max(BINAURAL.MIN, lastBinauralFreqOffset - 1), Math.min(BINAURAL.MAX, lastBinauralFreqOffset + 1));
          invertBinaural = !invertBinaural;
          beatsUntilBinauralShift = randomInt(2, 5);
          beatCount = 0;
        }
        p(c,
          { tick: beatStart, type: 'pitch_bend_c', values: [invertBinaural ? channelLeftInverted : channelLeft, invertBinaural ? binauralPitchBendMinus : binauralPitchBendPlus] },
          { tick: beatStart, type: 'pitch_bend_c', values: [invertBinaural ? channelRightInverted : channelRight, invertBinaural ? binauralPitchBendPlus : binauralPitchBendMinus] }
        );
      c.push(logUnit('beat')); beatCount++;
      for (divIndex = 0; divIndex < divsPerBeat; divIndex++) {
        divStart = beatStart + divIndex * ticksPerDiv;
        c.push(logUnit('division'));
        const { MIN, MAX, WEIGHTS } = SUBDIVISIONS;
        subdivsPerDiv = randomWeightedSelection(MIN, MAX, WEIGHTS);
        ticksPerSubdiv = ticksPerDiv / Math.max(1, subdivsPerDiv);
        useSubdiv = Math.random() < variate(.3, [-.2, .2], .3);
        for (subdivIndex = 0; subdivIndex < subdivsPerDiv; subdivIndex++) {
          subdivStart = divStart + subdivIndex * ticksPerSubdiv;
          c.push(logUnit('subdivision'));
          notes = composer.composeChord();
          notes.forEach(({ note }) => {
            sustain = useSubdiv ? variate(randomFloat(Math.max(ticksPerDiv * .5, ticksPerDiv / subdivsPerDiv), (ticksPerBeat * (.3 + Math.random() * .7))), [.1, .2], [-.05, -.1], .1) : variate(randomFloat(ticksPerDiv * .8, (ticksPerBeat * (.3 + Math.random() * .7))), [.1, .3], [-.05, -.1], .1);
            mainOn = subdivStart + variate(Math.random() * ticksPerSubdiv * .07, [-.07, .07], .3);
            mainSustain = sustain * variate(randomFloat(.9, 1.2));
            p(c,
              { tick: mainOn, type: 'note_on_c', values: [channelCenter, note, velocity * (randomFloat(.95, 1.05))] },
              { tick: mainOn + mainSustain, values: [channelCenter, note] }
            );
            const randomVelocity = variate(velocity * randomFloat(.33, .44));
            p(c,
              { tick: mainOn + variate(ticksPerSubdiv * Math.random() * .1, [-.06, .03], .3), type: 'note_on_c', values: invertBinaural ? [channelLeftInverted, note, randomVelocity * randomFloat(.97, 1.03)] : [channelLeft, note, randomVelocity * randomFloat(.97, 1.03)] },
              { tick: mainOn + mainSustain * variate(randomFloat(.96, 1.01)), values: [invertBinaural ? channelLeftInverted : channelLeft, note] },
              { tick: mainOn + variate(ticksPerSubdiv * Math.random() * .1, [-.06, .03], .3), type: 'note_on_c', values: [invertBinaural ? channelRightInverted : channelRight, note, randomVelocity * randomFloat(.97, 1.03)] },
              { tick: mainOn + mainSustain * variate(randomFloat(.96, 1.01)), values: [invertBinaural ? channelRightInverted : channelRight, note] }
            );
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
