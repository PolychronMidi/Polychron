require('./sheet'); require('./backstage'); 
midiSync=()=>{
  function isPowerOf2(n) { return (n & (n - 1))===0; }
  meterRatio=numerator / denominator;
  if (isPowerOf2(denominator)) { midiMeter=[numerator, denominator]; }
  else {
    const high=2 ** m.ceil(m.log2(denominator));  const highRatio=numerator / high;
    const low=2 ** m.floor(m.log2(denominator));  const lowRatio=numerator / low;
    midiMeter=m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio) ? [numerator, high] : [numerator, low];
  }
  midiMeterRatio=midiMeter[0] / midiMeter[1];
  syncFactor=midiMeterRatio / meterRatio;
  midiBPM=BPM * syncFactor;
  ticksPerMeasure=PPQ * 4 * midiMeterRatio;
  ticksPerBeat=ticksPerMeasure / numerator;
  return;
};

rhythms = {
  'binary': { weights: [2, 3, 1], method: 'binary', args: (length) => [length] },
  'hex': { weights: [2, 3, 1], method: 'hex', args: (length) => [length] },
  'onsets': { weights: [5, 0, 0], method: 'onsets', args: (length) => [{ make: [length, () => [1, 2]] }] },
  'onsets2': { weights: [0, 2, 0], method: 'onsets', args: (length) => [{ make: [length, [2, 3, 4]] }] },
  'onsets3': { weights: [0, 0, 7], method: 'onsets', args: (length) => [{ make: [length, () => [3, 7]] }] },
  'random': { weights: [7, 0, 0], method: 'random', args: (length) => [length, rv(.97, [-.1, .3], .2)] },
  'random2': { weights: [0, 3, 0], method: 'random', args: (length) => [length, rv(.9, [-.3, .3], .3)] },
  'random3': { weights: [0, 0, 1], method: 'random', args: (length) => [length, rv(.6, [-.3, .3], .3)] },
  'euclid': { weights: [3, 3, 3], method: 'euclid', args: (length) => [length, closestDivisor(length, m.ceil(rf(2, length / rf(1,1.2))))] },
  'rotate': { weights: [2, 2, 2], method: 'rotate', args: (length, pattern) => [pattern, ri(2), '?', length] },
  'morph': { weights: [2, 3, 3], method: 'morph', args: (length, pattern) => [pattern, '?', length] }
};

rhythm = (level, length, pattern) => {
  const levelIndex = ['beat', 'div', 'subdiv'].indexOf(level);
  const filteredRhythms = Object.fromEntries(
    Object.entries(rhythms).filter(([_, { weights }]) => weights[levelIndex] > 0)
  );
  const rhythmKey = selectFromWeightedOptions(filteredRhythms);
  if (rhythmKey && rhythms[rhythmKey]) {
    const { method, args } = rhythms[rhythmKey];
    return composer.getRhythm(method, ...args(length, pattern));
  }
  return console.warn('unknown rhythm');
};

p=pushMultiple=(array, ...items)=>{  array.push(...items);  };  c=csvRows=[];
logUnit=(type)=>{  let shouldLog=false;
  if (LOG==='none') shouldLog=false;
  else if (LOG==='all') shouldLog=true;
  else {  const logList=LOG.split(',').map(item=>item.trim());
    shouldLog=logList.length===1 ? logList[0]===type : logList.includes(type);  }
  if (!shouldLog) return null;  let meterInfo='';
  if (type==='measure') {
    thisUnit=measureIndex + 1;
    unitsPerParent=totalMeasures;
    startTime=currentTime;
    ticksPerSecond=midiBPM * PPQ / 60;
    secondsPerMeasure=ticksPerMeasure / (midiBPM * PPQ / 60);
    endTime=currentTime + secondsPerMeasure;
    startTick=currentTick;
    endTick=currentTick + ticksPerMeasure;
    originalMeter=[numerator, denominator];
    secondsPerBeat=ticksPerBeat / ticksPerSecond;
    composerDetails=`${composer.constructor.name} `;
    if (composer.scale && composer.scale.name) {
      composerDetails+=`${composer.root} ${composer.scale.name}`;
    } else if (composer.progression) {
      progressionSymbols=composer.progression.map(chord=>{
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails+=`${progressionSymbols}`;
    } else if (composer.mode && composer.mode.name) {
      composerDetails+=`${composer.root} ${composer.mode.name}`;
    }
    meterInfo=midiMeter[1]===originalMeter[1] ? `Meter: ${originalMeter.join('/')} Composer: ${composerDetails}` : `Original Meter: ${originalMeter.join('/')} Spoofed Meter: ${midiMeter.join('/')} Composer: ${composerDetails}`;
  } else if (type==='beat') {
    thisUnit=beatIndex + 1;
    unitsPerParent=numerator;
    startTime=currentTime + beatIndex * secondsPerBeat;
    endTime=startTime + secondsPerBeat;
    startTick=beatStart;
    endTick=startTick + ticksPerBeat;
    secondsPerDiv=secondsPerBeat / divsPerBeat;
  } else if (type==='division') {
    thisUnit=divIndex + 1;
    unitsPerParent=divsPerBeat;
    startTime=currentTime + beatIndex * secondsPerBeat + divIndex * secondsPerDiv;
    endTime=startTime + secondsPerDiv;
    startTick=divStart;
    endTick=startTick + ticksPerDiv;
    secondsPerSubdiv=secondsPerDiv / subdivsPerDiv;
  } else if (type==='subdivision') {
    thisUnit=subdivIndex + 1;
    unitsPerParent=subdivsPerDiv;
    startTime=currentTime + beatIndex * secondsPerBeat + divIndex * secondsPerDiv + subdivIndex * secondsPerSubdiv;
    endTime=startTime + secondsPerSubdiv;
    startTick=subdivStart;
    endTick=startTick + ticksPerSubdiv;
  }
  finalTime=formatTime(endTime + SILENT_OUTRO_SECONDS);
  return {
    tick: startTick,
    type: 'marker_t',
    values: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${thisUnit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  };
};
