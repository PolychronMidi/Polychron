require('./sheet'); require('./backstage'); 

midiSync = () => {
  function isPowerOf2(n) { return (n & (n - 1)) === 0; }
  if (isPowerOf2(denominator)) { midiMeter = [numerator, denominator]; syncFactor = 1; }
  else {
    const ceilDenominator = 2 ** Math.ceil(Math.log2(denominator));
    const floorDenominator = 2 ** Math.floor(Math.log2(denominator));
    const meterRatio = numerator / denominator;
    const ceilRatio = numerator / ceilDenominator;
    const floorRatio = numerator / floorDenominator;
    if (Math.abs(meterRatio - ceilRatio) < Math.abs(meterRatio - floorRatio)) 
      { midiMeter = [numerator, ceilDenominator]; syncFactor = meterRatio / ceilRatio; }
    else { midiMeter = [numerator, floorDenominator]; syncFactor = meterRatio / floorRatio; }
  }
  const midiBPM = BPM * syncFactor;
  const ticksPerMeasure = PPQ * 4 * (numerator / denominator) * syncFactor;
  const ticksPerBeat = ticksPerMeasure / numerator;
  return { midiMeter, midiBPM, ticksPerMeasure, ticksPerBeat };
};

// Random weighted selection. Any sized list of weights with any values will be normalized to fit the range.
r = randomWeightedSelection = (min, max, weights) => {
  const range = max - min + 1;
  let effectiveWeights = weights;
  if (weights.length !== range) {
    const firstWeight = weights[0];
    const lastWeight = weights[weights.length - 1];
    if (weights.length < range) {
      const newWeights = [firstWeight];
      for (let i = 1; i < range - 1; i++) {
        const fraction = i / (range - 1);
        const lowerIndex = Math.floor(fraction * (weights.length - 1));
        const upperIndex = Math.ceil(fraction * (weights.length - 1));
        const weightDiff = weights[upperIndex] - weights[lowerIndex];
        const interpolatedWeight = weights[lowerIndex] + (fraction * (weights.length - 1) - lowerIndex) * weightDiff;
        newWeights.push(interpolatedWeight);
      }
      newWeights.push(lastWeight);
      effectiveWeights = newWeights;
    } else if (weights.length > range) {
      effectiveWeights = [firstWeight];
      const groupSize = Math.floor(weights.length / (range - 1));
      for (let i = 1; i < range - 1; i++) {
        const startIndex = i * groupSize;
        const endIndex = Math.min(startIndex + groupSize, weights.length - 1);
        const groupSum = weights.slice(startIndex, endIndex).reduce((sum, w) => sum + w, 0);
        effectiveWeights.push(groupSum / (endIndex - startIndex));
      }
      effectiveWeights.push(lastWeight);
    }
  }
  const totalWeight = effectiveWeights.reduce((acc, w) => acc + w, 0);
  const normalizedWeights = effectiveWeights.map(w => w / totalWeight);
  let random = Math.random();
  let cumulativeProbability = 0;
  for (let i = 0; i < normalizedWeights.length; i++) {
    cumulativeProbability += normalizedWeights[i];
    if (random <= cumulativeProbability) { return i + min; }
  }
}

selectFromWeightedOptions = (options) => {
  const types = Object.keys(options);
  const weights = types.map(type => options[type]);
  const selectedIndex = r(0, types.length - 1, weights);
  return types[selectedIndex];
};

rhythmWeights = {
  'beat': {
    'onsets': 0.1,
    'random': 0.8,
    'euclid': 0.1
  },
  'div': {
    'onsets': 0.3,
    'random': 0.5,
    'euclid': 0.2
  },
  'subdiv': {
    'onsets': 0.2,
    'random': 0.6,
    'euclid': 0.2,
    'rotate': 1,
    'morph': 1
  }
};

const beatRhythms = {
  'onsets': { method: 'onsets', args: (length) => [{ build: [length, () => [1, 3]] }] },
  'random': { method: 'random', args: (length) => [length, v(.97,[-.3,.3],.2)] },
  'euclid': { method: 'euclid', args: (length) => [length, closestDivisor(length, Math.ceil(randomFloat(2, length / randomFloat(1.2))))] },
};
const divRhythms = {
  'onsets': { method: 'onsets', args: (length) => [{ build: [length, () => [1, 3]] }] },
  'random': { method: 'random', args: (length) => [length, v(.9, [-.3, .3], .3)] },
  'euclid': { method: 'euclid', args: (length) => [length, closestDivisor(length, Math.ceil(randomFloat(2, length / randomFloat(length / length - randomFloat(1.2))))) ] },
};
const subdivRhythms = {
  'onsets': { method: 'onsets', args: (length) => [{ build: [length, () => [1, 3]] }] },
  'random': { method: 'random', args: (length) => [length, v(.6,[-.3,.3],.3)] },
  'euclid': { method: 'euclid', args: (length) => [length, closestDivisor(length, Math.ceil(randomFloat(2, length / randomFloat(length / length - randomFloat(1.2))))) ] },
  'rotate': { method: 'rotate', args: () => [lastSubdivRhythm, 1, 'random'] },
  'morph': { method: 'morph', args: () => [lastSubdivRhythm, 'random'] }
};

rhythm = (level) => {
  const rhythm = selectFromWeightedOptions(rhythmWeights[level]);
  switch (level) {
    case 'beat':
      switch (rhythm) {
        case 'onsets':
        case 'random':
        case 'euclid':
          if (beatRhythms[rhythm]) {
            const methodInfo = beatRhythms[rhythm];
            const args = methodInfo.args(numerator);
            return composer.setRhythm(methodInfo.method, ...args);
          }
          break;
        default:
          return console.warn('unknown rhythm');
      }
      case 'div':
        switch (rhythm) {
          case 'onsets':
          case 'random':
          case 'euclid':
            if (divRhythms[rhythm]) {
              const methodInfo = divRhythms[rhythm];
              const args = methodInfo.args(divsPerBeat);
              return composer.setRhythm(methodInfo.method, ...args);
            }
            break;
          default:
            return console.warn('unknown rhythm');
        }
    case 'subdiv':
      switch (rhythm) {
        case 'onsets':
        case 'random':
        case 'euclid':
        case 'rotate':
        case 'morph':
          if (subdivRhythms[rhythm]) {
            const methodInfo = subdivRhythms[rhythm];
            const args = methodInfo.args(subdivsPerDiv);
            return composer.setRhythm(methodInfo.method, ...args);
          }
          break;
        default:
          return console.warn('unknown rhythm');
      }
    default:
      return console.warn('unknown rhythm level');
    }
};

// Random variation within range(s) at frequency. Give one range or a separate boost and deboost range.
v = (value, boostRange = [.05, .10], deboostRange = boostRange, frequency = .05) => {
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

p = pushMultiple = (array, ...items) => {  array.push(...items);  };
c = csvRows = [];
logUnit = (type) => {
  let shouldLog = false;
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else {
    const logList = LOG.split(',').map(item => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
  }
  if (!shouldLog) return null;
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
    originalMeter = [numerator, denominator];
    secondsPerBeat = ticksPerBeat / ticksPerSecond;
    composerDetails = `${composer.constructor.name} `;
    if (composer.scale && composer.scale.name) {
      composerDetails += `${composer.root} ${composer.scale.name}`;
    } else if (composer.progression) {
      progressionSymbols = composer.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    } else if (composer.mode && composer.mode.name) {
      composerDetails += `${composer.root} ${composer.mode.name}`;
    }
    meterInfo = midiMeter[1] === originalMeter[1] ? `Meter: ${originalMeter.join('/')} Composer: ${composerDetails}` : `Original Meter: ${originalMeter.join('/')} Spoofed Meter: ${midiMeter.join('/')} Composer: ${composerDetails}`;
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
  finalTime = formatTime(endTime + SILENT_OUTRO_SECONDS);
  return {
    tick: startTick,
    type: 'marker_t',
    values: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${thisUnit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  };
};
