const { Scale, Note, Chord } = require("tonal");
const fs = require('fs');
const config = require('./config');

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max) => Math.random() * (max - min) + min;
const roundToSix = (num) => Math.round(num * 1000000) / 1000000;

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
  
class MeasureGenerator {
  constructor(config) {
    this.config = config;
  }

  generateMeter() {
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

  generateNotes(measure, beat, division, beatsInMeasure) {
    const voices = randomInt(1, this.config.MAX_VOICES);
    const uniqueNotes = new Set();
    const notes = [];
    while (uniqueNotes.size < voices) {
      const note = this.generateNote(measure, beat, division, beatsInMeasure);
      if (uniqueNotes.add(note)) {
        notes.push({ note });
      }
    }
    return notes;
  }

  generateNote(measure, beat, division, beatsInMeasure) {
    const rawNote = this.generateRawNote(measure, beat, division, beatsInMeasure);
    const octave = this.getOctave();
    const midiNote = Note.midi(`${rawNote}${octave}`);
    if (midiNote === null) {
      throw new Error(`Invalid note generated: ${rawNote}${octave}`);
    }
    return midiNote;
  }

  generateRawNote(measure, beat, division, beatsInMeasure) {
    throw new Error("Method 'generateRawNote()' must be implemented.");
  }
}

class RandomScaleGenerator extends MeasureGenerator {
  constructor(config) {
    super(config);
    this.scales = Scale.names();
    this.currentScale = null;
    this.selectRandomScale();
  }

  selectRandomScale() {
    const validScales = this.scales.filter(scaleName => {
      return Note.names().some(root => {
        const scale = Scale.get(`${root} ${scaleName}`);
        return scale.notes.length > 0;
      });
    });
    if (validScales.length === 0) {
      throw new Error("No valid scales found");
    }
    const randomScaleName = validScales[Math.floor(Math.random() * validScales.length)];
    const randomRoot = Note.names()[Math.floor(Math.random() * 12)];
    this.currentScale = Scale.get(`${randomRoot} ${randomScaleName}`);
    if (this.currentScale.notes.length === 0) {
      this.selectRandomScale();
    }
  }

  generateRawNote(measure) {
    if (!this.currentScale || this.currentScale.notes.length === 0) {
      this.selectRandomScale();
    }
    return this.currentScale.notes[Math.floor(Math.random() * this.currentScale.notes.length)] || 'C';
  }
}

class ScaleBasedGenerator extends MeasureGenerator {
  constructor(config, scaleName, root) {
    super(config);
    this.scale = Scale.get(`${root} ${scaleName}`);
    this.notes = this.scale.notes;
  }

  generateRawNote() {
    return this.notes[Math.floor(Math.random() * this.notes.length)];
  }
}

class ChordProgressionGenerator extends MeasureGenerator {
  constructor(config, progression) {
    super(config);
    this.progression = progression.map(Chord.get);
    this.currentChordIndex = 0;
  }

  generateRawNote() {
    const chord = this.progression[this.currentChordIndex];
    const noteIndex = Math.floor(Math.random() * chord.notes.length);
    this.currentChordIndex = (this.currentChordIndex + 1) % this.progression.length;
    return chord.notes[noteIndex];
  }
}

const createMeasureGenerator = (generatorConfig, config) => {
  switch (generatorConfig.type) {
    case 'randomScale':
      return new RandomScaleGenerator(config);
    case 'scale':
      return new ScaleBasedGenerator(config, generatorConfig.name, generatorConfig.root);
    case 'chord':
      return new ChordProgressionGenerator(config, generatorConfig.progression);
    default:
      throw new Error(`Unknown note generator type: ${generatorConfig.type}`);
  }
};

const generateAuditEvent = (type, number, startTime, endTime, ticksStart, ticksEnd) => {
  return {
    startTicks: Math.round(ticksStart),
    type: 'Marker_t',
    values: [`${type} ${number} (${startTime.toFixed(6)}s - ${endTime.toFixed(6)}s)`]
  };
};

const createCsv = (measureGenerator, config) => {
  let csvContent = `0, 0, Header, 1, 1, ${config.PPQ}\n`;
  csvContent += "1, 0, Start_track\n";
  let totalTicks = 0;
  let totalSeconds = 0;
  let trackEnd = 0;
  const numberOfMeasures = randomInt(config.MIN_MEASURES, config.MAX_MEASURES);
  let midiEvents = [];

  for (let measureIndex = 0; measureIndex < numberOfMeasures; measureIndex++) {
    const measure = measureGenerator.generateMeter();
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

    midiEvents.push(generateAuditEvent('Measure', measureIndex + 1, totalSeconds, totalSeconds + secondsPerMeasure, totalTicks, totalTicks + ticksPerMeasure));

    for (let beat = 0; beat < numerator; beat++) {
      const beatStartTicks = totalTicks + beat * ticksPerBeat;
      const beatStartSeconds = totalSeconds + beat * secondsPerBeat;
      const divisionsForBeat = measureGenerator.applyDivision(numerator, beat);
      const ticksPerDivision = ticksPerBeat / divisionsForBeat;
      const secondsPerDivision = secondsPerBeat / divisionsForBeat;

      midiEvents.push(generateAuditEvent('Beat', beat + 1, beatStartSeconds, beatStartSeconds + secondsPerBeat, beatStartTicks, beatStartTicks + ticksPerBeat));

      for (let division = 0; division < divisionsForBeat; division++) {
        const divisionStartTicks = beatStartTicks + division * ticksPerDivision;
        const divisionStartSeconds = beatStartSeconds + division * secondsPerDivision;

        midiEvents.push(generateAuditEvent('Division', division + 1, divisionStartSeconds, divisionStartSeconds + secondsPerDivision, divisionStartTicks, divisionStartTicks + ticksPerDivision));

        const notes = measureGenerator.generateNotes(measure, beat, division, numerator);
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

const noteGeneratorConfig = config.NOTE_GENERATORS[randomInt(0, config.NOTE_GENERATORS.length - 1)];
const measureGenerator = createMeasureGenerator(noteGeneratorConfig, config);
createCsv(measureGenerator, config);
console.log('output.csv created');
