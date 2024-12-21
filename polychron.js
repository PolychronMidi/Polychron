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
  let midiEvents = [];
  const channel = 0;
  if (config.TUNING.FREQUENCY != 440) {
    midiEvents.push({
      startTick: 0,
      type: 'Pitch_bend_c',
      values: [channel, config.TUNING.PITCH_BEND]
    });
  }
  let totalTicks = totalTime = 0;
  const totalMeasures = randomInt(config.MEASURES.MIN, config.MEASURES.MAX);
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const milliseconds = Math.floor((seconds - Math.floor(seconds)) * 1000);
    return `${minutes}:${remainingSeconds.toFixed(3).padStart(6, '0')}`;
  };
  const setUnitMarker = (type, number, startTime, endTime, startTick, endTick, originalMeter = [], midiMeter = null) => {
    let meterInfo = '';
    if (type === 'Measure') {
      meterInfo = midiMeter 
        ? `Original Meter: ${originalMeter.join('/')} Spoofed Meter: ${midiMeter.join('/')}`
        : `Meter: ${originalMeter.join('/')}`;
    }
    return {
      startTick: Math.round(startTick),
      type: 'Marker_t',
      endTime: endTime,
      values: [`${type} ${number} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${Math.round(endTick)} ${meterInfo ? meterInfo : ''}`]
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
  for (let measureIndex = 0; measureIndex < totalMeasures; measureIndex++) {
    const randomComposer = config.COMPOSERS[randomInt(0, config.COMPOSERS.length - 1)];
    const composer = compose(randomComposer, config);
    const measure = composer.setMeter();
    const [numerator, denominator] = measure.meter;
    const { midiMeter, tempoFactor } = midiCompatibleMeter(numerator, denominator);
    const spoofedTempo = config.BASE_TEMPO * tempoFactor;
    ticksPerSecond = spoofedTempo * config.PPQ / 60;
    const ticksPerMeasure = config.PPQ * 4 * (midiMeter[0] / midiMeter[1]);
    const ticksPerBeat = ticksPerMeasure / numerator;
    const secondsPerMeasure = ticksPerMeasure / ticksPerSecond;
    const secondsPerBeat = ticksPerBeat / ticksPerSecond;
    midiEvents.push({
      startTick: totalTicks,
      type: 'Time_signature',
      values: [midiMeter[0], Math.log2(midiMeter[1]), 24, 8]
    });
    midiEvents.push({
      startTick: totalTicks,
      type: 'Tempo',
      values: [Math.round(60000000 / spoofedTempo)]
    });
    midiEvents.push(setUnitMarker('Measure', measureIndex + 1, totalTime, totalTime + secondsPerMeasure, totalTicks, totalTicks + ticksPerMeasure, measure.meter, midiMeter[0] !== measure.meter[0] || midiMeter[1] !== measure.meter[1] ? midiMeter : null));
    for (let beat = 0; beat < numerator; beat++) {
      const beatStartTick = totalTicks + beat * ticksPerBeat;
      const beatStartTime = totalTime + beat * secondsPerBeat;
      const divisionsForBeat = composer.setDivisions(numerator, beat);
      const ticksPerDivision = ticksPerBeat / divisionsForBeat;
      const secondsPerDivision = secondsPerBeat / divisionsForBeat;
      midiEvents.push(setUnitMarker('Beat', beat + 1, beatStartTime, beatStartTime + secondsPerBeat, beatStartTick, beatStartTick + ticksPerBeat));
      for (let division = 0; division < divisionsForBeat; division++) {
        const divisionStartTick = beatStartTick + division * ticksPerDivision;
        const divisionStartTime = beatStartTime + division * secondsPerDivision;
        midiEvents.push(setUnitMarker('Division', division + 1, divisionStartTime, divisionStartTime + secondsPerDivision, divisionStartTick, divisionStartTick + ticksPerDivision));
        const notes = composer.composeChord(measure, beat, division, numerator);
        notes.forEach(({ note }) => {
          const velocity = 99;
          midiEvents.push({
            startTick: Math.round(divisionStartTick + Math.random() * ticksPerDivision * 0.05),
            type: 'Note_on_c',
            values: [channel, note, velocity]
          });
          midiEvents.push({
            startTick: Math.round(divisionStartTick + ticksPerDivision * randomFloat(.1, 5)),
            type: 'Note_off_c',
            values: [channel, note, 0]
          });
        });
      }
    }
    totalTicks += ticksPerMeasure;
    totalTime += secondsPerMeasure;
  }
  midiEvents.sort((a, b) => a.startTick - b.startTick);
  midiEvents.forEach(event => {
    if (event.type === 'Marker_t') {
      csvContent += `1, ${event.startTick}, Marker_t, ${event.values.join(' ')}\n`;
    } else {
      csvContent += `1, ${event.startTick}, ${event.type}, ${event.values.join(', ')}\n`;
    }
    const outroSilence = ticksPerSecond * config.SILENT_OUTRO_SECONDS;
    trackEndTick = Math.round(Math.max(event.startTick + outroSilence));
  });
  trackEndTime = formatTime(totalTime + config.SILENT_OUTRO_SECONDS);
  csvContent += `1, ${trackEndTick}, End_track\n`;
  csvContent += `0, ${trackEndTick}, End_of_file`;
  fs.writeFileSync('output.csv', csvContent);
};
csvMaestro(config);
console.log('output.csv created. Track Length:', trackEndTime);
