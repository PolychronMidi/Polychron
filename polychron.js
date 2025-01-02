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
function randomWeightedSelection(min, max, weights) {
  const range = max - min + 1;
  let expandedWeights = weights;
  if (weights.length < range) {
    const weightPerGroup = Math.floor(range / weights.length);
    const remainder = range % weights.length;
    expandedWeights = [];
    weights.forEach((weight, index) => {
      const count = index < remainder ? weightPerGroup + 1 : weightPerGroup;
      expandedWeights.push(...Array(count).fill(weight));
    });
  }
  const totalWeight = expandedWeights.reduce((acc, w) => acc + w, 0);
  const normalizedWeights = expandedWeights.map(w => w / totalWeight);
  let random = Math.random();
  let cumulativeProbability = 0;
  for (let i = 0; i < normalizedWeights.length; i++) {
    cumulativeProbability += normalizedWeights[i];
    if (random <= cumulativeProbability) {
      return i + min;
    }
  }
}
class MeasureComposer {
  constructor(sheet) {
    this.sheet = sheet;
  }
  setMeter() {
    const { MIN: nMin, MAX: nMax, WEIGHTS: nWeights } = this.sheet.NUMERATOR;
    const { MIN: dMin, MAX: dMax, WEIGHTS: dWeights } = this.sheet.DENOMINATOR;
    return {
      meter: [
        randomWeightedSelection(nMin, nMax, nWeights),
        randomWeightedSelection(dMin, dMax, dWeights)
      ]
    };
  }
  setOctave() {
    const { MIN, MAX, WEIGHTS } = this.sheet.OCTAVE;
    return randomWeightedSelection(MIN, MAX, WEIGHTS);
  }
  setDivisions(beatsPerMeasure, currentBeat) {
    const { MIN, MAX, WEIGHTS } = this.sheet.DIVISIONS;
    return randomWeightedSelection(MIN, MAX, WEIGHTS);
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
    const { MIN, MAX, WEIGHTS } = this.sheet.VOICES;
    const voices = randomWeightedSelection(MIN, MAX, WEIGHTS);
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
  let composition = `0, 0, header, 1, 1, ${sheet.PPQ}\n`;
  composition += "1, 0, start_track\n";
  let c = [];
  const channelCenter = 0;  const channelLeft = 1;  const channelRight = 2;
  const channelLeftInverted = 3;  const channelRightInverted = 4; 
  c.push({
    startTick: 0,
    type: 'control_c',
    values: [channelLeft, 10, 0]
  });
  c.push({
    startTick: 0,
    type: 'control_c',
    values: [channelRight, 10, 127]
  });
  c.push({
    startTick: 0,
    type: 'control_c',
    values: [channelLeftInverted, 10, 0]
  });
  c.push({
    startTick: 0,
    type: 'control_c',
    values: [channelRightInverted, 10, 127]
  });
  const neutralPitchBend = 8192; const semitone = neutralPitchBend / 2;
  const centsToTuningFreq = 1200 * Math.log2(sheet.TUNING_FREQ / 440);
  const tuningPitchBend = Math.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));
  c.push({
    startTick: 0,
    type: 'pitch_bend_c',
    values: [channelCenter, tuningPitchBend]
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
    const binauralFreqOffset = randomFloat(sheet.BINAURAL.MIN, sheet.BINAURAL.MAX);
    const centsToOffsetPlus = 1200 * Math.log2((sheet.TUNING_FREQ + binauralFreqOffset) / sheet.TUNING_FREQ);
    const centsToOffsetMinus = 1200 * Math.log2((sheet.TUNING_FREQ - binauralFreqOffset) / sheet.TUNING_FREQ);
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
    c.push(setUnitMarker('Measure', measureIndex + 1, currentTime, currentTime + secondsPerMeasure, currentTick, currentTick + ticksPerMeasure, measure.meter, midiMeter[0] !== measure.meter[0] || midiMeter[1] !== measure.meter[1] ? midiMeter : null));
    for (let beat = 0; beat < numerator; beat++) {
      const beatStartTick = currentTick + beat * ticksPerBeat;
      const beatStartTime = currentTime + beat * secondsPerBeat;
      const divisionsPerBeat = composer.setDivisions(numerator, beat);
      const ticksPerDivision = ticksPerBeat / divisionsPerBeat;
      const secondsPerDivision = secondsPerBeat / divisionsPerBeat;
      c.push(setUnitMarker('Beat', beat + 1, beatStartTime, beatStartTime + secondsPerBeat, beatStartTick, beatStartTick + ticksPerBeat));
      for (let division = 0; division < divisionsPerBeat; division++) {
        const divisionStartTick = beatStartTick + division * ticksPerDivision;
        const divisionStartTime = beatStartTime + division * secondsPerDivision;
        c.push(setUnitMarker('Division', division + 1, divisionStartTime, divisionStartTime + secondsPerDivision, divisionStartTick, divisionStartTick + ticksPerDivision));
        const notes = composer.composeChord(measure, beat, division, numerator);
        notes.forEach(({ note }) => {
          const velocity = 99;
          const noteOnTick = divisionStartTick + Math.random() * ticksPerDivision * 0.07;
          const noteOffTick = divisionStartTick + ticksPerDivision * randomFloat(.2, 4);
          c.push({
            startTick: noteOnTick,
            type: 'note_on_c',
            values: [channelCenter, note, velocity]
          });
          c.push({
            startTick: noteOffTick,
            type: 'note_off_c',
            values: [channelCenter, note]
          });
          const randomVelocity = velocity * randomFloat(.33,.44);
          if (invertBinaural = false) {
            c.push({
              startTick: noteOnTick,
              type: 'note_on_c',
              values: [channelLeft, note, randomVelocity]
            });
            c.push({
              startTick: noteOffTick,
              type: 'note_off_c',
              values: [channelLeft, note]
            });
            c.push({
              startTick: noteOnTick,
              type: 'note_on_c',
              values: [channelRight, note, randomVelocity]
            });
            c.push({
              startTick: noteOffTick,
              type: 'note_off_c',
              values: [channelRight, note]
            });
          } else {
            c.push({
              startTick: noteOnTick,
              type: 'note_on_c',
              values: [channelLeftInverted, note, randomVelocity]
            });
            c.push({
              startTick: noteOffTick,
              type: 'note_off_c',
              values: [channelLeftInverted, note]
            });
            c.push({
              startTick: noteOnTick,
              type: 'note_on_c',
              values: [channelRightInverted, note, randomVelocity]
            });
            c.push({
              startTick: noteOffTick,
              type: 'note_off_c',
              values: [channelRightInverted, note]
            });
          }
        });
      }
    }
    currentTick += ticksPerMeasure;
    currentTime += secondsPerMeasure;
  }
  c.sort((a, b) => a.startTick - b.startTick);
  c.forEach(_ => {
    if (_.type === 'marker_t') {
      composition += `1, ${_.startTick}, marker_t, ${_.values.join(' ')}\n`;
    } else {
      composition += `1, ${_.startTick}, ${_.type}, ${_.values.join(', ')}\n`;
    }
    trackEndTick = Math.max(_.startTick + ticksPerSecond * sheet.SILENT_OUTRO_SECONDS);
  });
  trackEndTime = formatTime(currentTime + sheet.SILENT_OUTRO_SECONDS);
  composition += `1, ${trackEndTick}, end_track\n`;
  fs.writeFileSync('output.csv', composition);
};
csvMaestro(sheet);
console.log('output.csv created. Track Length:', trackEndTime);
