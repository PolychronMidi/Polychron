const t = require("tonal");
const fs = require('fs');
const config = require('./config');
const randomFloat = (min = 0, max) => {
  if (max === undefined) { max = min; min = 0; }
  return Math.random() * (max - min) + min;
};
const randomInt = (min = 0, max) => {
  const floatValue = randomFloat(min, max);
  return Math.floor(floatValue);
};
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
    return this.notes[randomInt(this.notes.length)];  }
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
    const randomScale = validScales[randomInt(validScales.length)];
    const randomRoot = allNotes[randomInt(allNotes.length)];
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
    const noteIndex = randomInt(chord.notes.length);
    this.currentChordIndex = (this.currentChordIndex + 1) % (this.progression.length - 1);
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
      const randomChord = allChords[randomInt(allChords.length)];
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
  let csvContent = `0, 0, header, 1, 1, ${config.PPQ}\n`;
  csvContent += "1, 0, start_track\n";
  let midiEvents = [];
  const channelCenter = 0;
  const channelLeft = 1;
  const channelRight = 2;
  if (config.TUNING.FREQUENCY != 440) {
    midiEvents.push({
      startTick: 0,
      type: 'pitch_bend_c',
      values: [channelCenter, config.TUNING.PITCH_BEND]
    });
  }
  midiEvents.push({
    startTick: 0,
    type: 'control_c',
    values: [channelLeft, 10, 0]
  });
  midiEvents.push({
    startTick: 0,
    type: 'control_c',
    values: [channelRight, 10, 127]
  });
  let currentTick = currentTime = 0;
  const totalMeasures = randomInt(config.MEASURES.MIN, config.MEASURES.MAX);
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    seconds = (seconds % 60).toFixed(4).padStart(7, '0');
    return `${minutes}:${seconds}`;
  };
  const setUnitMarker = (type, number, startTime, endTime, startTick, endTick, originalMeter = [], midiMeter = null) => {
    let meterInfo = '';
    if (type === 'Measure') {
      meterInfo = midiMeter 
        ? `Original Meter: ${originalMeter.join('/')} Spoofed Meter: ${midiMeter.join('/')}`
        : `Meter: ${originalMeter.join('/')}`;
    }
    return {
      startTick: startTick,
      type: 'marker_t',
      endTime: endTime,
      values: [`${type} ${number} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
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
    const randomComposer = config.COMPOSERS[randomInt(config.COMPOSERS.length)];
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
      startTick: currentTick,
      type: 'meter',
      values: [midiMeter[0], midiMeter[1]]
    });
    midiEvents.push({
      startTick: currentTick,
      type: 'bpm',
      values: [spoofedTempo]
    });
    const neutralPitchBend = 8192;
    const semitone = neutralPitchBend / 2;
    const frequencyOffset = randomFloat(7, 13);
    const targetFrequencyLeft = config.TUNING.FREQUENCY + frequencyOffset;
    const targetFrequencyRight = config.TUNING.FREQUENCY - frequencyOffset;
    const centsToTargetLeft = 1200 * Math.log2(targetFrequencyLeft / config.TUNING.FREQUENCY);
    const centsToTargetRight = 1200 * Math.log2(targetFrequencyRight / config.TUNING.FREQUENCY);
    const pitchBendLeft = Math.round(config.TUNING.PITCH_BEND + (semitone * (centsToTargetLeft / 100)));
    const pitchBendRight = Math.round(config.TUNING.PITCH_BEND + (semitone * (centsToTargetRight / 100)));
    if (Math.random() > 0.5) {
      midiEvents.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelLeft, pitchBendLeft]
      });
      midiEvents.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelRight, pitchBendRight]
      });
    } else {
      midiEvents.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelRight, pitchBendLeft]
      });
      midiEvents.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelLeft, pitchBendRight]
      });
    }
    midiEvents.push(setUnitMarker('Measure', measureIndex + 1, currentTime, currentTime + secondsPerMeasure, currentTick, currentTick + ticksPerMeasure, measure.meter, midiMeter[0] !== measure.meter[0] || midiMeter[1] !== measure.meter[1] ? midiMeter : null));
    for (let beat = 0; beat < numerator; beat++) {
      const beatStartTick = currentTick + beat * ticksPerBeat;
      const beatStartTime = currentTime + beat * secondsPerBeat;
      const divisionsPerBeat = composer.setDivisions(numerator, beat);
      const ticksPerDivision = ticksPerBeat / divisionsPerBeat;
      const secondsPerDivision = secondsPerBeat / divisionsPerBeat;
      midiEvents.push(setUnitMarker('Beat', beat + 1, beatStartTime, beatStartTime + secondsPerBeat, beatStartTick, beatStartTick + ticksPerBeat));
      for (let division = 0; division < divisionsPerBeat; division++) {
        const divisionStartTick = beatStartTick + division * ticksPerDivision;
        const divisionStartTime = beatStartTime + division * secondsPerDivision;
        midiEvents.push(setUnitMarker('Division', division + 1, divisionStartTime, divisionStartTime + secondsPerDivision, divisionStartTick, divisionStartTick + ticksPerDivision));
        const notes = composer.composeChord(measure, beat, division, numerator);
        notes.forEach(({ note }) => {
          const velocity = 99;
          const noteOnTick = divisionStartTick + Math.random() * ticksPerDivision * 0.05;
          const noteOffTick = divisionStartTick + ticksPerDivision * randomFloat(.1, 5);
          midiEvents.push({
            startTick: noteOnTick,
            type: 'note_on_c',
            values: [channelCenter, note, velocity]
          });
          midiEvents.push({
            startTick: noteOffTick,
            type: 'note_off_c',
            values: [channelCenter, note]
          });
          const randVel = velocity * randomFloat(.3,.45);
          midiEvents.push({
            startTick: noteOnTick,
            type: 'note_on_c',
            values: [channelLeft, note, randVel]
          });
          midiEvents.push({
            startTick: noteOffTick,
            type: 'note_off_c',
            values: [channelLeft, note]
          });
          midiEvents.push({
            startTick: noteOnTick,
            type: 'note_on_c',
            values: [channelRight, note, randVel]
          });
          midiEvents.push({
            startTick: noteOffTick,
            type: 'note_off_c',
            values: [channelRight, note]
          });
        });
      }
    }
    currentTick += ticksPerMeasure;
    currentTime += secondsPerMeasure;
  }
  midiEvents.sort((a, b) => a.startTick - b.startTick);
  midiEvents.forEach(event => {
    if (event.type === 'marker_t') {
      csvContent += `1, ${event.startTick}, marker_t, ${event.values.join(' ')}\n`;
    } else {
      csvContent += `1, ${event.startTick}, ${event.type}, ${event.values.join(', ')}\n`;
    }
    const outroSilence = ticksPerSecond * config.SILENT_OUTRO_SECONDS;
    trackEndTick = Math.max(event.startTick + outroSilence);
  });
  trackEndTime = formatTime(currentTime + config.SILENT_OUTRO_SECONDS);
  csvContent += `1, ${trackEndTick}, end_track\n`;
  fs.writeFileSync('output.csv', csvContent);
};
csvMaestro(config);
console.log('output.csv created. Track Length:', trackEndTime);
