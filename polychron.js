const t = require("tonal");
const fs = require('fs');
const s = require('./sheet');
const u = require('./utils');
class MeasureComposer {
  constructor(s) {
    this.s = s;
  }
  setMeter() {
    const { MIN: nMin, MAX: nMax, WEIGHTS: nWeights } = this.s.NUMERATOR;
    const { MIN: dMin, MAX: dMax, WEIGHTS: dWeights } = this.s.DENOMINATOR;
    return {
      meter: [
        u.randomWeightedSelection(nMin, nMax, nWeights),
        u.randomWeightedSelection(dMin, dMax, dWeights)
      ]
    };
  }
  setOctave() {
    const { MIN, MAX, WEIGHTS } = this.s.OCTAVE;
    return u.randomWeightedSelection(MIN, MAX, WEIGHTS);
  }
  setDivisions() {
    const { MIN, MAX, WEIGHTS } = this.s.DIVISIONS;
    return u.randomWeightedSelection(MIN, MAX, WEIGHTS);
  }
  composeNote(measure, beat, division, beatsPerMeasure) {
    const rawNote = this.composeRawNote(measure, beat, division, beatsPerMeasure);
    const octave = this.setOctave();
    const composedNote = t.Note.midi(`${rawNote}${octave}`);
    if (composedNote === null) {
      throw new Error(`Invalid note composed: ${rawNote}${octave}`);
    }
    return composedNote;
  }
  composeChord(measure, beat, division, beatsPerMeasure) {
    const { MIN, MAX, WEIGHTS } = this.s.VOICES;
    const voices = u.randomWeightedSelection(MIN, MAX, WEIGHTS);
    const uniqueNotes = new Set();
    const composedChord = [];
    while (uniqueNotes.size < voices) {
      const note = this.composeNote(measure, beat, division, beatsPerMeasure);
      if (uniqueNotes.add(note)) {
        composedChord.push({ note });
      }
    }
    return composedChord;
  }
}
class ScaleComposer extends MeasureComposer {
  constructor(s, scaleName, root) {
    super(s);
    this.setScale(scaleName, root);
  }
  setScale(scaleName, root) {
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }
  composeRawNote() {
    return this.notes[u.randomInt(this.notes.length)];  }
}
class RandomScaleComposer extends ScaleComposer {
  constructor(s) {
    super(s, '', '');
    this.scales = t.Scale.names();
    this.randomScale();
  }
  randomScale() {
    const validScales = this.scales.filter(scaleName => {
      return u.allNotes.some(root => {
        const scale = t.Scale.get(`${root} ${scaleName}`);
        return scale.notes.length > 0;
      });
    });
    const randomScale = validScales[u.randomInt(validScales.length)];
    const randomRoot = u.allNotes[u.randomInt(u.allNotes.length)];
    this.setScale(randomScale, randomRoot);
  }
  composeRawNote(measure) {
    if (this.notes.length === 0) {
      this.randomScale();
    }
    return super.composeRawNote();
  }
}
class ChordComposer extends MeasureComposer {
  constructor(s, progression) {
    super(s);
    this.setProgression(progression);
  }
  setProgression(progression) {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!u.allChords.includes(chordSymbol)) {
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
    const noteIndex = u.randomInt(chord.notes.length);
    this.currentChordIndex = (this.currentChordIndex + 1) % (this.progression.length - 1);
    return chord.notes[noteIndex];
  }
}
class RandomChordComposer extends ChordComposer {
  constructor(s) {
    super(s, []);
    this.randomProgression();
  }
  randomProgression() {
    const progressionLength = u.randomInt(3, 8);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = u.allChords[u.randomInt(u.allChords.length)];
      randomProgression.push(randomChord);
    }
    this.setProgression(randomProgression);
  }
  composeRawNote() {
    if (this.progression.length === 0) {
      this.randomProgression();
    }
    return super.composeRawNote();
  }
}
(function csvMaestro(s) {
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
  const totalMeasures = u.randomInt(s.MEASURES.MIN, s.MEASURES.MAX);
  for (let measureIndex = 0; measureIndex < totalMeasures; measureIndex++) {
    const randomComposer = u.randomInt(s.COMPOSERS.length);
    const composers = (function(s) {  return s.COMPOSERS.map(composer => 
      eval(`(function(s) { return ${composer.return}; }).call({name: '${composer.name || ''}', root: '${composer.root || ''}', progression: ${JSON.stringify(composer.progression || [])}}, s)`)  );  })(s);
    const composer = composers[randomComposer];
    const measure = composer.setMeter();
    const [numerator, denominator] = measure.meter;
    const { midiMeter, tempoFactor } = u.midiCompatibleMeter(numerator, denominator);
    const spoofedTempo = s.BASE_TEMPO * tempoFactor;
    ticksPerSecond = spoofedTempo * s.PPQ / 60;
    const ticksPerMeasure = s.PPQ * 4 * (midiMeter[0] / midiMeter[1]);
    const ticksPerBeat = ticksPerMeasure / numerator;
    const secondsPerMeasure = ticksPerMeasure / ticksPerSecond;
    const secondsPerBeat = ticksPerBeat / ticksPerSecond;
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
    const binauralFreqOffset = u.randomFloat(s.BINAURAL.MIN, s.BINAURAL.MAX);
    const centsToOffsetPlus = 1200 * Math.log2((s.TUNING_FREQ + binauralFreqOffset) / s.TUNING_FREQ);
    const centsToOffsetMinus = 1200 * Math.log2((s.TUNING_FREQ - binauralFreqOffset) / s.TUNING_FREQ);
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
    c.push(u.setUnitMarker('Measure', measureIndex + 1, currentTime, currentTime + secondsPerMeasure, currentTick, currentTick + ticksPerMeasure, measure.meter, midiMeter[0] !== measure.meter[0] || midiMeter[1] !== measure.meter[1] ? midiMeter : null));
    for (let beat = 0; beat < numerator; beat++) {
      const beatStartTick = currentTick + beat * ticksPerBeat;
      const beatStartTime = currentTime + beat * secondsPerBeat;
      const divisionsPerBeat = Math.ceil(composer.setDivisions() * ((numerator / denominator) < 1 ? (numerator / denominator) : 1 / (numerator / denominator)));
      const ticksPerDivision = ticksPerBeat / divisionsPerBeat;
      const secondsPerDivision = secondsPerBeat / divisionsPerBeat;
      c.push(u.setUnitMarker('Beat', beat + 1, beatStartTime, beatStartTime + secondsPerBeat, beatStartTick, beatStartTick + ticksPerBeat));
      for (let division = 0; division < divisionsPerBeat; division++) {
        const divisionStartTick = beatStartTick + division * ticksPerDivision;
        const divisionStartTime = beatStartTime + division * secondsPerDivision;
        c.push(u.setUnitMarker('Division', division + 1, divisionStartTime, divisionStartTime + secondsPerDivision, divisionStartTick, divisionStartTick + ticksPerDivision));
        const notes = composer.composeChord(measure, beat, division, numerator);
        notes.forEach(({ note }) => {
          const velocity = 99;
          const noteOffTick = divisionStartTick + ticksPerDivision * u.randomFloat(.3, 4);
          c.push({
            startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
            type: 'note_on_c',
            values: [channelCenter, note, velocity + (u.randomFloat(-.05,.05) * velocity)]
          });
          c.push({
            startTick: noteOffTick + ticksPerDivision * u.randomFloat(-.05, .05),
            type: 'note_off_c',
            values: [channelCenter, note]
          });
          const randomVelocity = velocity * u.randomFloat(.33,.4);
          if (invertBinaural = false) {
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelLeft, note, randomVelocity + (u.randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * u.randomFloat(-.05, .05),
              type: 'note_off_c',
              values: [channelLeft, note]
            });
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelRight, note, randomVelocity + (u.randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * u.randomFloat(-.05, .05),
              type: 'note_off_c',
              values: [channelRight, note]
            });
          } else {
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelLeftInverted, note, randomVelocity + (u.randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * u.randomFloat(-.05, .05),
              type: 'note_off_c',
              values: [channelLeftInverted, note]
            });
            c.push({
              startTick: divisionStartTick + Math.random() * ticksPerDivision * 0.07,
              type: 'note_on_c',
              values: [channelRightInverted, note, randomVelocity + (u.randomFloat(-.05,.05) * randomVelocity)]
            });
            c.push({
              startTick: noteOffTick + ticksPerDivision * u.randomFloat(-.05, .05),
              type: 'note_off_c',
              values: [channelRightInverted, note]
            });
          }
        });
      }
    }
    currentTick += ticksPerMeasure;  currentTime += secondsPerMeasure;
  }
  c.sort((a, b) => a.startTick - b.startTick);
  c.forEach(_ => {
    if (_.type === 'marker_t') {
      composition += `1, ${_.startTick}, marker_t, ${_.values.join(' ')}\n`;
    } else {
      composition += `1, ${_.startTick || 0}, ${_.type}, ${_.values.join(', ')}\n`;
    }
    trackEndTick = Math.max(_.startTick + ticksPerSecond * s.SILENT_OUTRO_SECONDS);
  });
  composition += `1, ${trackEndTick}, end_track\n`;
  fs.writeFileSync('output.csv', composition);
  console.log('output.csv created. Track Length:', u.formatTime(currentTime + s.SILENT_OUTRO_SECONDS));
})(s);
