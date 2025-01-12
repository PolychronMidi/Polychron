require('./sheet'); require('./backstage'); 
midiSync=()=>{
  function isPowerOf2(n) { return (n & (n - 1))===0; }
  const meterRatio=numerator / denominator;
  let syncFactorBPM=syncFactorTicks=1;
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
  return { midiMeter, midiBPM, ticksPerMeasure, ticksPerBeat, meterRatio };
};
rhythmWeights={
  'beat': {
    'binary': 2,
    'hex': 2,
    'onsets': 5,
    'random': 7,
    'euclid': 3,
    'rotate': 2,
    'morph': 2
  },
  'div': {
    'binary': 3,
    'hex': 3,
    'onsets2': 2,
    'random2': 3,
    'euclid': 3,
    'rotate': 2,
    'morph': 3
  },
  'subdiv': {
    'binary': 1,
    'hex': 1,
    'onsets3': 7,
    'random3': 1,
    'euclid': 3,
    'rotate': 2,
    'morph': 3
  }
};
const rhythms={
  'binary': { method: 'binary', args: (length)=>[length] },
  'hex': { method: 'hex', args: (length)=>[length] },
  'onsets': { method: 'onsets', args: (length)=>[{ make: [length, ()=>[1, 2]] }] },//range
  'onsets2': { method: 'onsets', args: (length)=>[{ make: [length, [2, 3, 4]] }] },//values
  'onsets3': { method: 'onsets', args: (length)=>[{ make: [length, ()=>[3, 7]] }] },
  'random': { method: 'random', args: (length)=>[length, v(.97, [-.1, .3], .2)] },
  'random2': { method: 'random', args: (length)=>[length, v(.9, [-.3, .3], .3)] },
  'random3': { method: 'random', args: (length)=>[length, v(.6, [-.3, .3], .3)] },
  'euclid': { method: 'euclid', args: (length)=>[length, closestDivisor(length, m.ceil(randomFloat(2, length / randomFloat(1,1.2))))] },
  'rotate': { method: 'rotate', args: (length, pattern)=>[pattern, randomInt(2), '?', length] },
  'morph': { method: 'morph', args: (length, pattern)=>[pattern, '?', length] }
};
rhythm=(level, length, pattern)=>{
  const rhythm=selectFromWeightedOptions(rhythmWeights[level]);
  switch (level) {
    case 'beat':
      switch (rhythm) {
        case 'binary':
        case 'hex':
        case 'onsets':
        case 'random':
        case 'euclid':
        case 'rotate':
        case 'morph':
          if (rhythms[rhythm]) {
            const methodInfo=rhythms[rhythm];
            const args=methodInfo.args(length, pattern);
            return composer.setRhythm(methodInfo.method, ...args);
          }
          break;
        default:
          return console.warn('unknown rhythm');
      }
      case 'div':
        switch (rhythm) {
          case 'binary':
          case 'hex':
          case 'onsets2':
          case 'random2':
          case 'euclid':
          case 'rotate':
          case 'morph':
            if (rhythms[rhythm]) {
              const methodInfo=rhythms[rhythm];
              const args=methodInfo.args(length, pattern);
              return composer.setRhythm(methodInfo.method, ...args);
            }
            break;
          default:
            return console.warn('unknown rhythm');
        }
    case 'subdiv':
      switch (rhythm) {
        case 'binary':
        case 'hex':
        case 'onsets3':
        case 'random3':
        case 'euclid':
        case 'rotate':
        case 'morph':
          if (rhythms[rhythm]) {
            const methodInfo=rhythms[rhythm];
            const args=methodInfo.args(length, pattern);
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
