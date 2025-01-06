require('./sheet'); t = require("tonal"); fs = require('fs');

randomFloat = (min = 0, max) => {
  if (max === undefined) { max = min; min = 0; }
  return Math.random() * (max - min) + min;
};

randomInt = (min = 0, max) => {
  const floatValue = randomFloat(min, max);
  return Math.floor(floatValue);
};

allNotes = t.Scale.get("C chromatic").notes.map(note => 
  t.Note.enharmonic(t.Note.get(note))
);

allScales = t.Scale.names().filter(scaleName => {
  return allNotes.some(root => {
    const scale = t.Scale.get(`${root} ${scaleName}`);
    return scale.notes.length > 0;
  });
});

allChords = (function() {
  function getChordNotes(chordType, root) {
    const chord = t.Chord.get(`${root} ${chordType}`);
    if (!chord.empty && chord.symbol) {
      return { symbol: chord.symbol, notes: chord.notes };
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

midiCompatibleMeter = (numerator, denominator) => {
  function isPowerOf2(n) {
    return (n & (n - 1)) === 0;
  }
  if (isPowerOf2(denominator)) {
    return { midiMeter: [numerator, denominator], bpmFactor: 1 };
  } else {
    const ceilDenominator = 2 ** Math.ceil(Math.log2(denominator));
    const floorDenominator = 2 ** Math.floor(Math.log2(denominator));
    const meterRatio = numerator / denominator;
    const ceilRatio = numerator / ceilDenominator;
    const floorRatio = numerator / floorDenominator;
    return Math.abs(meterRatio - ceilRatio) < Math.abs(meterRatio - floorRatio) 
    ? { midiMeter: [numerator, ceilDenominator], bpmFactor: meterRatio / ceilRatio }
    : { midiMeter: [numerator, floorDenominator], bpmFactor: meterRatio / floorRatio };
  }
};

randomWeightedSelection = (min, max, weights) => {
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

variate = (value, boostRange = [.05, .10], deboostRange = boostRange, frequency = .05) => {
  const singleRange = Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange = singleRange.length === 2 && typeof singleRange[0] === 'number' && typeof singleRange[1] === 'number';
  let factor;
  if (isSingleRange) {
    const variation = randomFloat(...singleRange);
    factor = Math.random() < frequency ? 1 + variation : 1;
  } else {
    const range = Math.random() < .5 ? boostRange : deboostRange;
    factor = Math.random() < frequency 
      ? 1 + randomFloat(...range)
      : 1;
  }
  return value * factor;
};

logUnit = (type) => {
  let shouldLog = false;
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else {
    const logList = LOG.split(',').map(item => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
  }
  if (!shouldLog) return null;
  let thisUnit = 1, startTime = 0, endTime = 0, startTick = 0, endTick = 0, originalMeter = [], midiMeter = null;
  let meterInfo = '';
  if (type === 'measure') {
    thisUnit = measureIndex + 1;
    unitsPerParent = totalMeasures;
    startTime = currentTime;
    ticksPerSecond = midiBPM * PPQ / 60;
    secondsPerMeasure = ticksPerMeasure / (midiBPM * PPQ / 60);
    endTime = currentTime + secondsPerMeasure;
    startTick = currentTick;
    endTick = currentTick + ticksPerMeasure;
    originalMeter = measure.meter;
    midiMeter = midiMeter;
    secondsPerBeat = ticksPerBeat / ticksPerSecond;
    composerDetails = `${composer.constructor.name} `;
    if (composer.scale && composer.scale.name) {
      composerDetails += `${composer.scale.name}`;
    }
    if (composer.progression) {
      progressionSymbols = composer.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    }
    meterInfo = midiMeter ? `Original Meter: ${originalMeter.join('/')} Spoofed Meter: ${midiMeter.join('/')} Composer: ${composerDetails}` : `Meter: ${originalMeter.join('/')} Composer: ${composerDetails}`;
  } else if (type === 'beat') {
    thisUnit = beatIndex + 1;
    unitsPerParent = numerator;
    startTime = currentTime + beatIndex * secondsPerBeat;
    endTime = startTime + secondsPerBeat;
    startTick = beatStart;
    endTick = startTick + ticksPerBeat;
    secondsPerDiv = secondsPerBeat / divsPerBeat;
  } else if (type === 'division') {
    thisUnit = divIndex + 1;
    unitsPerParent = divsPerBeat;
    startTime = currentTime + beatIndex * secondsPerBeat + divIndex * secondsPerDiv;
    endTime = startTime + secondsPerDiv;
    startTick = divStart;
    endTick = startTick + ticksPerDiv;
    secondsPerSubdiv = secondsPerDiv / subdivsPerDiv;
  } else if (type === 'subdivision') {
    thisUnit = subdivIndex + 1;
    unitsPerParent = subdivsPerDiv;
    startTime = currentTime + beatIndex * secondsPerBeat + divIndex * secondsPerDiv + subdivIndex * secondsPerSubdiv;
    endTime = startTime + secondsPerSubdiv;
    startTick = subdivStart;
    endTick = startTick + ticksPerSubdiv;
  }
  return {
    tick: startTick,
    type: 'marker_t',
    values: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${thisUnit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  };
};

p = pushMultiple = (array, ...items) => {  array.push(...items);  };
c = [];
composition = `0, 0, header, 1, 1, ${PPQ}\n1, 0, start_track\n`;
finale = () => `1, ${finalTick + ticksPerSecond * SILENT_OUTRO_SECONDS}, end_track`;

neutralPitchBend = 8192; semitone = neutralPitchBend / 2;
centsToTuningFreq = 1200 * Math.log2(TUNING_FREQ / 440);
tuningPitchBend = Math.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

binauralFreqOffset = randomFloat(BINAURAL.MIN, BINAURAL.MAX);
centsToOffsetPlus = 1200 * Math.log2((TUNING_FREQ + binauralFreqOffset) / TUNING_FREQ);
centsToOffsetMinus = 1200 * Math.log2((TUNING_FREQ - binauralFreqOffset) / TUNING_FREQ);
binauralPitchBendPlus = Math.round(tuningPitchBend + (semitone * (centsToOffsetPlus / 100)));
binauralPitchBendMinus = Math.round(tuningPitchBend + (semitone * (centsToOffsetMinus / 100)));
invertBinaural = lastBinauralFreqOffset = beatsUntilBinauralShift = beatCount = 0;

channelCenter = 0;  channelLeft = 1;  channelRight = 2;
channelLeftInverted = 3;  channelRightInverted = 4;
currentTick = currentTime = 0;
velocity = 99;

formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  seconds = (seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};
