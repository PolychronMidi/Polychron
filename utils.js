t = require("tonal");
s = require('./sheet');
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
const formatTime = (seconds) => {
const minutes = Math.floor(seconds / 60);
seconds = (seconds % 60).toFixed(4).padStart(7, '0');
return `${minutes}:${seconds}`;
};
const logUnit = (type, number, startTime, endTime, startTick, endTick, originalMeter = [], midiMeter = null) => {
let meterInfo = '';
if (type === 'Measure') {
    meterInfo = midiMeter ? `Original Meter: ${originalMeter.join('/')} Spoofed Meter: ${midiMeter.join('/')}` : `Meter: ${originalMeter.join('/')}`;
}
return {
    startTick: startTick,
    type: 'marker_t',
    endTime: endTime,
    values: [`${type} ${number} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
};
};
composition = `0, 0, header, 1, 1, ${s.PPQ}\n`;
composition += "1, 0, start_track\n";
c = [];
channelCenter = 0;  channelLeft = 1;  channelRight = 2;
channelLeftInverted = 3;  channelRightInverted = 4; 
neutralPitchBend = 8192; semitone = neutralPitchBend / 2;
centsToTuningFreq = 1200 * Math.log2(s.TUNING_FREQ / 440);
tuningPitchBend = Math.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));
currentTick = currentTime = 0;
module.exports = {
    s,
    randomFloat,
    randomInt,
    allNotes,
    allChords,
    midiCompatibleMeter,
    randomWeightedSelection,
    formatTime,
    logUnit,
  };
