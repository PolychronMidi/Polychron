const t = require("tonal");
const fs = require('fs');
const config = require('./config');
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max) => Math.random() * (max - min) + min;
const allNotes = t.Scale.get("C chromatic").notes.map(note => 
  t.Note.enharmonic(t.Note.get(note))
);
const allChords = (function() {
  function getChordNotes(chordType, root) {
    try {
      const chord = t.Chord.get(`${root} ${chordType}`);
      if (chord.empty || !chord.symbol) return null;
      return { symbol: chord.symbol, notes: chord.notes };
    } catch (error) {
      return null;
    }
  }
  const allChords = new Set();
  t.ChordType.all().forEach(chordType => {
    allNotes.forEach(root => {
      const chord = getChordNotes(chordType.name, root);
      if (chord) {
        allChords.add(chord.symbol);
      }
    });
  });
  return Array.from(allChords);
})();
function midiCompatibleMeter(numerator, denominator) {
  function isPowerOf2(n) {
    return (n & (n - 1)) === 0;
  }
  if (isPowerOf2(denominator)) {
    return { midiMeter: [numerator, denominator], tempoFactor: 1 };
  } else {
    const ceilDenominator = 2 ** Math.ceil(Math.log2(denominator));
    const floorDenominator = 2 ** Math.floor(Math.log2(denominator));
    const meterRatio = numerator / denominator;
    const ceilRatio = numerator / ceilDenominator;
    const floorRatio = numerator / floorDenominator;
    return Math.abs(meterRatio - ceilRatio) < Math.abs(meterRatio - floorRatio) 
    ? { midiMeter: [numerator, ceilDenominator], tempoFactor: meterRatio / ceilRatio }
    : { midiMeter: [numerator, floorDenominator], tempoFactor: meterRatio / floorRatio };
  }
}
class MeasureComposer {
  constructor(config) {
    this.config = config;
  }
  setMeter() {
    const numerator = randomInt(this.config.NUMERATOR.MIN, this.config.NUMERATOR.MAX);
    const denominator = randomInt(this.config.DENOMINATOR.MIN, this.config.DENOMINATOR.MAX);
    return { meter: [numerator, denominator] };
  }
  setDivisions(beatsInMeasure, currentBeat) {
    return randomInt(this.config.DIVISIONS.MIN, this.config.DIVISIONS.MAX);
  }
  setOctave() {
    return randomInt(this.config.OCTAVE.MIN, this.config.OCTAVE.MAX);
  }
  composeNote(measure, beat, division, beatsInMeasure) {
    const rawNote = this.composeRawNote(measure, beat, division, beatsInMeasure);
    const octave = this.setOctave();
    const composedNote = t.Note.midi(`${rawNote}${octave}`);
    if (composedNote === null) {
      throw new Error(`Invalid note composed: ${rawNote}${octave}`);
    }
    return composedNote;
  }
  composeChord(measure, beat, division, beatsInMeasure) {
    const voices = randomInt(this.config.VOICES.MIN, this.config.VOICES.MAX);
    const uniqueNotes = new Set();
    const composedChord = [];
    while (uniqueNotes.size < voices) {
      const note = this.composeNote(measure, beat, division, beatsInMeasure);
      if (uniqueNotes.add(note)) {
        composedChord.push({ note });
      }
    }
    return composedChord;
  }
}
class ScaleComposer extends MeasureComposer {
  constructor(config, scaleName, root) {
    super(config);
    this.setScale(scaleName, root);
  }
  setScale(scaleName, root) {
    this.scale = t.Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }
  composeRawNote() {
    return this.notes[Math.floor(Math.random() * this.notes.length)];
  }
}
class RandomScaleComposer extends ScaleComposer {
  constructor(config) {
    super(config, '', '');
    this.scales = t.Scale.names();
    this.randomScale();
  }
  randomScale() {
    const validScales = this.scales.filter(scaleName => {
      return allNotes.some(root => {
        const scale = t.Scale.get(`${root} ${scaleName}`);
        return scale.notes.length > 0;
      });
    });
    const randomScale = validScales[Math.floor(Math.random() * validScales.length)];
    const randomRoot = allNotes[Math.floor(Math.random() * allNotes.length)];
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
  constructor(config, progression) {
    super(config);
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
    const noteIndex = Math.floor(Math.random() * chord.notes.length);
    this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    return chord.notes[noteIndex];
  }
}
class RandomChordComposer extends ChordComposer {
  constructor(config) {
    super(config, []);
    this.randomProgression();
  }
  randomProgression() {
    const progressionLength = randomInt(3, 8);
    const randomProgression = [];
    for (let i = 0; i < progressionLength; i++) {
      const randomChord = allChords[Math.floor(Math.random() * allChords.length)];
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
const csvMaestro = (config) => {
  let csvContent = `0, 0, Header, 1, 1, ${config.PPQ}\n`;
  csvContent += "1, 0, Start_track\n";
  let totalTicks = 0;
  let totalSeconds = 0;
  let trackEnd = 0;
  let midiEvents = [];
  const numberOfMeasures = randomInt(config.MEASURES.MIN, config.MEASURES.MAX);
  const setUnitMarker = (type, number, startTime, endTime, ticksStart, ticksEnd) => {
    return {
      startTicks: Math.round(ticksStart),
      type: 'Marker_t',
      values: [`${type} ${number} (${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s)`]
    };
  };
  const compose = (composerConfig, config) => {
    switch (composerConfig.type) {
      case 'scale':
        return new ScaleComposer(config, composerConfig.name, composerConfig.root);
      case 'randomScale':
        return new RandomScaleComposer(config);
      case 'chordProgression':
        return new ChordComposer(config, composerConfig.progression);
      case 'randomChordProgression':
        return new RandomChordComposer(config);
      default:
        throw new Error(`Unknown COMPOSERS type: ${composerConfig.type}`);
    }
  };
  for (let measureIndex = 0; measureIndex < numberOfMeasures; measureIndex++) {
    const randomComposer = config.COMPOSERS[randomInt(0, config.COMPOSERS.length - 1)];
    const composer = compose(randomComposer, config);
    const measure = composer.setMeter();
    const [numerator, denominator] = measure.meter;
    const { midiMeter, tempoFactor } = midiCompatibleMeter(numerator, denominator);
    const spoofedTempo = config.BASE_TEMPO * tempoFactor;
    const ticksPerMeasure = Math.round((config.PPQ * 4) * (numerator / denominator));
    const ticksPerBeat = ticksPerMeasure / numerator;
    const ticksPerSecond = (spoofedTempo * config.PPQ) / 60;
    const secondsPerBeat = ticksPerBeat / ticksPerSecond;
    const secondsPerMeasure = ticksPerMeasure / ticksPerSecond;
    midiEvents.push({
      startTicks: totalTicks,
      type: 'Time_signature',
      values: [midiMeter[0], Math.log2(midiMeter[1]), 24, 8]
    });
    midiEvents.push({
      startTicks: totalTicks,
      type: 'Tempo',
      values: [Math.round(60000000 / spoofedTempo)]
    });
    midiEvents.push(setUnitMarker('Measure', measureIndex + 1, totalSeconds, totalSeconds + secondsPerMeasure, totalTicks, totalTicks + ticksPerMeasure));
    for (let beat = 0; beat < numerator; beat++) {
      const beatStartTicks = totalTicks + beat * ticksPerBeat;
      const beatStartSeconds = totalSeconds + beat * secondsPerBeat;
      const divisionsForBeat = composer.setDivisions(numerator, beat);
      const ticksPerDivision = ticksPerBeat / divisionsForBeat;
      const secondsPerDivision = secondsPerBeat / divisionsForBeat;
      midiEvents.push(setUnitMarker('Beat', beat + 1, beatStartSeconds, beatStartSeconds + secondsPerBeat, beatStartTicks, beatStartTicks + ticksPerBeat));
      for (let division = 0; division < divisionsForBeat; division++) {
        const divisionStartTicks = beatStartTicks + division * ticksPerDivision;
        const divisionStartSeconds = beatStartSeconds + division * secondsPerDivision;
        midiEvents.push(setUnitMarker('Division', division + 1, divisionStartSeconds, divisionStartSeconds + secondsPerDivision, divisionStartTicks, divisionStartTicks + ticksPerDivision));
        const notes = composer.composeChord(measure, beat, division, numerator);
        notes.forEach(({ note }) => {
          const channel = 0;
          const velocity = 99;
          midiEvents.push({
            startTicks: Math.round(divisionStartTicks),
            type: 'Note_on_c',
            values: [channel, note, velocity]
          });
          midiEvents.push({
            startTicks: Math.round(divisionStartTicks + (ticksPerDivision * randomFloat(.3, 3))),
            type: 'Note_off_c',
            values: [channel, note, 0]
          });
        });
      }
    }
    totalTicks += ticksPerMeasure;
    totalSeconds += secondsPerMeasure;
  }
  midiEvents.sort((a, b) => a.startTicks - b.startTicks);
  midiEvents.forEach(event => {
    if (event.type === 'Marker_t') {
      csvContent += `1, ${event.startTicks}, Marker_t, ${event.values.join(' ')}\n`;
    } else {
      csvContent += `1, ${event.startTicks}, ${event.type}, ${event.values.join(', ')}\n`;
    }
    trackEnd = Math.max(trackEnd, event.startTicks);
  });
  csvContent += `1, ${trackEnd}, End_track\n`;
  csvContent += `0, ${trackEnd}, End_of_file`;
  fs.writeFileSync('output.csv', csvContent);
};
csvMaestro(config);
console.log('output.csv created');
