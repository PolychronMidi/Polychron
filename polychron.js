const t = require("tonal");
const fs = require('fs');
const config = require('./config');
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max) => Math.random() * (max - min) + min;
const allNotes = t.Scale.get("C chromatic").notes.map(note => 
  t.Note.enharmonic(t.Note.get(note))
);
function getAllChords() {
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
}
const allChords = getAllChords();
const spoofMeter = (numerator, denominator) => {
    return ((denominator & (denominator - 1)) === 0)
      ? { spoofedMeter: [numerator, denominator], tempoFactor: 1 }
      : (() => {
          const ceilDenominator = Math.pow(2, Math.ceil(Math.log2(denominator)));
          const floorDenominator = Math.pow(2, Math.floor(Math.log2(denominator)));
          const ceilTempoFactor = ceilDenominator / denominator;
          const floorTempoFactor = floorDenominator / denominator;
          return floorTempoFactor < ceilTempoFactor
            ? { spoofedMeter: [numerator, floorDenominator], tempoFactor: floorTempoFactor }
            : { spoofedMeter: [numerator, ceilDenominator], tempoFactor: ceilTempoFactor };
        })();
  };
class MeasureComposer {
  constructor(config) {
      this.config = config;
  }
  setMeter() {
      const numerator = randomInt(this.config.MIN_NUMERATOR, this.config.MAX_NUMERATOR);
      const denominator = randomInt(this.config.MIN_DENOMINATOR, this.config.MAX_DENOMINATOR);
      return { meter: [numerator, denominator] };
  }
  applyDivision(beatsInMeasure, currentBeat) {
      return randomInt(this.config.MIN_DIVISIONS, this.config.MAX_DIVISIONS);
  }
  getOctave() {
      return randomInt(this.config.OCTAVE_RANGE.MIN, this.config.OCTAVE_RANGE.MAX);
  }
  composeRawNote(measure, beat, division, beatsInMeasure) {
    throw new Error("Method 'composeRawNote()' must be implemented.");
}
  composeNote(measure, beat, division, beatsInMeasure) {
      const rawNote = this.composeRawNote(measure, beat, division, beatsInMeasure);
      const octave = this.getOctave();
      const composedNote = t.Note.midi(`${rawNote}${octave}`);
      if (composedNote === null) {
          throw new Error(`Invalid note composed: ${rawNote}${octave}`);
      }
      return composedNote;
  }
  composeNotes(measure, beat, division, beatsInMeasure) {
      const voices = randomInt(1, this.config.MAX_VOICES);
      const uniqueNotes = new Set();
      const composedNotes = [];
      while (uniqueNotes.size < voices) {
          const note = this.composeNote(measure, beat, division, beatsInMeasure);
          if (uniqueNotes.add(note)) {
              composedNotes.push({ note });
          }
      }
      return composedNotes;
  }
}
class ScaleComposer extends MeasureComposer {
    constructor(config, scaleName, root) {
        super(config);
        this.setScale(scaleName, root);
    }
    composeRawNote() {
      return this.notes[Math.floor(Math.random() * this.notes.length)];
  }
    setScale(scaleName, root) {
        this.scale = t.Scale.get(`${root} ${scaleName}`);
        this.notes = this.scale.notes;
    }
}
class RandomScaleComposer extends ScaleComposer {
    constructor(config) {
        super(config, '', '');
        this.scales = t.Scale.names();
        this.randomScale();
    }
    composeRawNote(measure) {
      if (this.notes.length === 0) {
          this.randomScale();
      }
      return super.composeRawNote();
  }
    randomScale() {
        const validScales = this.scales.filter(scaleName => {
            return allNotes.some(root => {
                const scale = t.Scale.get(`${root} ${scaleName}`);
                return scale.notes.length > 0;
            });
        });
        if (validScales.length === 0) {
            throw new Error("No valid scales found");
        }
        const randomScale = validScales[Math.floor(Math.random() * validScales.length)];
        const randomRoot = allNotes[Math.floor(Math.random() * allNotes.length)];
        this.setScale(randomScale, randomRoot);
        if (this.scale.notes.length === 0) {
            this.randomScale();
        }
    }
}
class ChordProgressionComposer extends MeasureComposer {
  constructor(config, progression) {
    super(config);
    this.setProgression(progression);
  }
  composeRawNote() {
    const chord = this.progression[this.currentChordIndex];
    const noteIndex = Math.floor(Math.random() * chord.notes.length);
    this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    return chord.notes[noteIndex];
  }
  setProgression(progression) {
    const validatedProgression = progression.filter(chordSymbol => {
      if (!allChords.includes(chordSymbol)) {
        console.warn(`Invalid chord symbol: ${chordSymbol}`);
        return false;
      }
      return true;
    });
    if (validatedProgression.length !== progression.length) {
      console.warn('Some chord symbols were removed due to invalidity');
    }
    this.progression = validatedProgression.map(t.Chord.get);
    this.currentChordIndex = 0;
  }
}
class RandomChordProgressionComposer extends ChordProgressionComposer {
  constructor(config) {
    super(config, []);
    this.randomProgression();
  }
  composeRawNote() {
    if (this.progression.length === 0) {
      this.randomProgression();
    }
    return super.composeRawNote();
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
}
const composeCsv = (config) => {
  let csvContent = `0, 0, Header, 1, 1, ${config.PPQ}\n`;
  csvContent += "1, 0, Start_track\n";
  let totalTicks = 0;
  let totalSeconds = 0;
  let trackEnd = 0;
  let midiEvents = [];
  const numberOfMeasures = randomInt(config.MIN_MEASURES, config.MAX_MEASURES);
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
        return new ChordProgressionComposer(config, composerConfig.progression);
      case 'randomChordProgression':
        return new RandomChordProgressionComposer(config);
      default:
        throw new Error(`Unknown COMPOSERS type: ${composerConfig.type}`);
    }
  };
  for (let measureIndex = 0; measureIndex < numberOfMeasures; measureIndex++) {
    const randomComposer = config.COMPOSERS[randomInt(0, config.COMPOSERS.length - 1)];
    const composer = compose(randomComposer, config);
    const measure = composer.setMeter();
    const [numerator, denominator] = measure.meter;
    const { spoofedMeter, tempoFactor } = spoofMeter(numerator, denominator);
    const spoofedTempo = config.BASE_TEMPO * tempoFactor;
    const ticksPerBeat = config.PPQ * 4 / spoofedMeter[1];
    const ticksPerMeasure = ticksPerBeat * numerator;
    const secondsPerBeat = (60 / spoofedTempo) * (4 / spoofedMeter[1]);
    const secondsPerMeasure = secondsPerBeat * numerator;
    midiEvents.push({
      startTicks: totalTicks,
      type: 'Time_signature',
      values: [spoofedMeter[0], Math.log2(spoofedMeter[1]), 24, 8]
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
      const divisionsForBeat = composer.applyDivision(numerator, beat);
      const ticksPerDivision = ticksPerBeat / divisionsForBeat;
      const secondsPerDivision = secondsPerBeat / divisionsForBeat;
      midiEvents.push(setUnitMarker('Beat', beat + 1, beatStartSeconds, beatStartSeconds + secondsPerBeat, beatStartTicks, beatStartTicks + ticksPerBeat));
      for (let division = 0; division < divisionsForBeat; division++) {
        const divisionStartTicks = beatStartTicks + division * ticksPerDivision;
        const divisionStartSeconds = beatStartSeconds + division * secondsPerDivision;
        midiEvents.push(setUnitMarker('Division', division + 1, divisionStartSeconds, divisionStartSeconds + secondsPerDivision, divisionStartTicks, divisionStartTicks + ticksPerDivision));
        const notes = composer.composeNotes(measure, beat, division, numerator);
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
composeCsv(config);
console.log('output.csv created');
