const t = require("tonal");
const fs = require('fs');
const sheet = require('./sheet');
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
  constructor(sheet) {
    this.sheet = sheet;
  }
  setMeter() {
    const numerator = randomInt(this.sheet.NUMERATOR.MIN, this.sheet.NUMERATOR.MAX);
    const denominator = randomInt(this.sheet.DENOMINATOR.MIN, this.sheet.DENOMINATOR.MAX);
    return { meter: [numerator, denominator] };
  }
  setDivisions(beatsInMeasure, currentBeat) {
    return randomInt(this.sheet.DIVISIONS.MIN, this.sheet.DIVISIONS.MAX);
  }
  setOctave() {
    const { MIN, MAX, WEIGHTS } = this.sheet.OCTAVE;
    const totalWeight = WEIGHTS.reduce((acc, w) => acc + w, 0);
    let random = Math.random() * totalWeight;
    for (let i = MIN - 1; i < MAX; i++) {
      random -= WEIGHTS[i];
      if (random <= 0) {
        return i + MIN;
      }
    }
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
    const voices = randomInt(this.sheet.VOICES.MIN, this.sheet.VOICES.MAX);
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
  constructor(sheet, scaleName, root) {
    super(sheet);
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
  constructor(sheet) {
    super(sheet, '', '');
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
  constructor(sheet, progression) {
    super(sheet);
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
  constructor(sheet) {
    super(sheet, []);
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
const csvMaestro = (sheet) => {
  let csvContent = `0, 0, header, 1, 1, ${sheet.PPQ}\n`;
  csvContent += "1, 0, start_track\n";
  let conductor = [];
  const channelCenter = 0;  const channelLeft = 1;  const channelRight = 2;
  if (sheet.TUNING.FREQUENCY != 440) {
    conductor.push({
      startTick: 0,
      type: 'pitch_bend_c',
      values: [channelCenter, sheet.TUNING.PITCH_BEND]
    });
  }
  conductor.push({
    startTick: 0,
    type: 'control_c',
    values: [channelLeft, 10, 0]
  });
  conductor.push({
    startTick: 0,
    type: 'control_c',
    values: [channelRight, 10, 127]
  });
  let currentTick = currentTime = 0;
  const totalMeasures = randomInt(sheet.MEASURES.MIN, sheet.MEASURES.MAX);
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
  const composers = (function(sheet) {
    return sheet.COMPOSERS.map(composer => 
      eval(`(function(sheet) { return ${composer.return}; }).call({name: '${composer.name || ''}', root: '${composer.root || ''}', progression: ${JSON.stringify(composer.progression || [])}}, sheet)`)
    );
  })(sheet);
  for (let measureIndex = 0; measureIndex < totalMeasures; measureIndex++) {
    const randomComposer = randomInt(sheet.COMPOSERS.length);
    const composer = composers[randomComposer];
    const measure = composer.setMeter();
    const [numerator, denominator] = measure.meter;
    const { midiMeter, tempoFactor } = midiCompatibleMeter(numerator, denominator);
    const spoofedTempo = sheet.BASE_TEMPO * tempoFactor;
    ticksPerSecond = spoofedTempo * sheet.PPQ / 60;
    const ticksPerMeasure = sheet.PPQ * 4 * (midiMeter[0] / midiMeter[1]);
    const ticksPerBeat = ticksPerMeasure / numerator;
    const secondsPerMeasure = ticksPerMeasure / ticksPerSecond;
    const secondsPerBeat = ticksPerBeat / ticksPerSecond;
    conductor.push({
      startTick: currentTick,
      type: 'meter',
      values: [midiMeter[0], midiMeter[1]]
    });
    conductor.push({
      startTick: currentTick,
      type: 'bpm',
      values: [spoofedTempo]
    });
    const neutralPitchBend = 8192;
    const semitone = neutralPitchBend / 2;
    const frequencyOffset = randomFloat(7, 13);
    const centsToOffsetPlus = 1200 * Math.log2((sheet.TUNING.FREQUENCY + frequencyOffset) / sheet.TUNING.FREQUENCY);
    const centsToOffsetMinus = 1200 * Math.log2((sheet.TUNING.FREQUENCY - frequencyOffset) / sheet.TUNING.FREQUENCY);
    const binauralPitchBendPlus = Math.round(sheet.TUNING.PITCH_BEND + (semitone * (centsToOffsetPlus / 100)));
    const binauralPitchBendMinus = Math.round(sheet.TUNING.PITCH_BEND + (semitone * (centsToOffsetMinus / 100)));
    if (Math.random() > 0.5) {
      conductor.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelLeft, binauralPitchBendPlus]
      });
      conductor.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelRight, binauralPitchBendMinus]
      });
    } else {
      conductor.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelRight, binauralPitchBendPlus]
      });
      conductor.push({
        startTick: currentTick,
        type: 'pitch_bend_c',
        values: [channelLeft, binauralPitchBendMinus]
      });
    }
    conductor.push(setUnitMarker('Measure', measureIndex + 1, currentTime, currentTime + secondsPerMeasure, currentTick, currentTick + ticksPerMeasure, measure.meter, midiMeter[0] !== measure.meter[0] || midiMeter[1] !== measure.meter[1] ? midiMeter : null));
    for (let beat = 0; beat < numerator; beat++) {
      const beatStartTick = currentTick + beat * ticksPerBeat;
      const beatStartTime = currentTime + beat * secondsPerBeat;
      const divisionsPerBeat = composer.setDivisions(numerator, beat);
      const ticksPerDivision = ticksPerBeat / divisionsPerBeat;
      const secondsPerDivision = secondsPerBeat / divisionsPerBeat;
      conductor.push(setUnitMarker('Beat', beat + 1, beatStartTime, beatStartTime + secondsPerBeat, beatStartTick, beatStartTick + ticksPerBeat));
      for (let division = 0; division < divisionsPerBeat; division++) {
        const divisionStartTick = beatStartTick + division * ticksPerDivision;
        const divisionStartTime = beatStartTime + division * secondsPerDivision;
        conductor.push(setUnitMarker('Division', division + 1, divisionStartTime, divisionStartTime + secondsPerDivision, divisionStartTick, divisionStartTick + ticksPerDivision));
        const notes = composer.composeChord(measure, beat, division, numerator);
        notes.forEach(({ note }) => {
          const velocity = 99;
          const noteOnTick = divisionStartTick + Math.random() * ticksPerDivision * 0.05;
          const noteOffTick = divisionStartTick + ticksPerDivision * randomFloat(.1, 5);
          conductor.push({
            startTick: noteOnTick,
            type: 'note_on_c',
            values: [channelCenter, note, velocity]
          });
          conductor.push({
            startTick: noteOffTick,
            type: 'note_off_c',
            values: [channelCenter, note]
          });
          const randVel = velocity * randomFloat(.3,.45);
          conductor.push({
            startTick: noteOnTick,
            type: 'note_on_c',
            values: [channelLeft, note, randVel]
          });
          conductor.push({
            startTick: noteOffTick,
            type: 'note_off_c',
            values: [channelLeft, note]
          });
          conductor.push({
            startTick: noteOnTick,
            type: 'note_on_c',
            values: [channelRight, note, randVel]
          });
          conductor.push({
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
  conductor.sort((a, b) => a.startTick - b.startTick);
  conductor.forEach(event => {
    if (event.type === 'marker_t') {
      csvContent += `1, ${event.startTick}, marker_t, ${event.values.join(' ')}\n`;
    } else {
      csvContent += `1, ${event.startTick}, ${event.type}, ${event.values.join(', ')}\n`;
    }
    trackEndTick = Math.max(event.startTick + ticksPerSecond * sheet.SILENT_OUTRO_SECONDS);
  });
  trackEndTime = formatTime(currentTime + sheet.SILENT_OUTRO_SECONDS);
  csvContent += `1, ${trackEndTick}, end_track\n`;
  fs.writeFileSync('output.csv', csvContent);
};
csvMaestro(sheet);
console.log('output.csv created. Track Length:', trackEndTime);
