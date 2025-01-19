require('./sheet'); require('./venue'); require('./backstage');
midiSync=()=>{
  meterRatio=numerator / denominator;
  isPowerOf2=(n)=>{ return (n & (n - 1))===0; }
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
//todo:
// makePolyrhythm(numerator*ri(1,3), denominator*ri(1,3));
makePolyrhythm=(polyNumerator,polyDenominator)=>{
  const meterRatio = numerator / denominator;
  const polyMeterRatio = polyNumerator / polyDenominator;
  let allMatches = [];
  let bestMatch = {
    originalMeasures: Infinity,
    polyMeasures: Infinity,
    totalMeasures: Infinity,
    polyNumerator: polyNumerator,
    polyDenominator: polyDenominator
  };
  for (let originalMeasures = 1; originalMeasures <= 20; originalMeasures++) {
    for (let polyMeasures = 1; polyMeasures <= 20; polyMeasures++) {
      if (Math.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < 0.0001) {
        let currentMatch = {
          originalMeasures: originalMeasures,
          polyMeasures: polyMeasures,
          totalMeasures: originalMeasures + polyMeasures,
          polyNumerator: polyNumerator,
          polyDenominator: polyDenominator
        };
        allMatches.push(currentMatch);
        if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
          bestMatch = currentMatch;
        }
      }
    }
  }
  console.log("All Matches:");
  allMatches.forEach(match => {
    console.log(`Original Measures: ${match.originalMeasures}, Poly Measures: ${match.polyMeasures}, Total Measures: ${match.totalMeasures}`);
  });
  if (bestMatch.totalMeasures===Infinity) {
    console.log("No polyrhythm match found within the given range.");
    return null; // or throw new Error('No polyrhythm match found within the given range.');
  } else {
    console.log("Best Match:");
    console.log(`Original Measures: ${bestMatch.originalMeasures}, Poly Measures: ${bestMatch.polyMeasures}, Total Measures: ${bestMatch.totalMeasures}`);
  }
  return bestMatch;
};

rhythms={
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

rhythm=(level,length,pattern)=>{
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

setRhythm=(level)=>{
  random=(length, probOn)=> { return t.RhythmPattern.random(length, 1 - probOn); };
  switch(level) {
    case 'beat':
      return beatRhythm = beatRhythm < 1 ? t.RhythmPattern.random(numerator, 0) : rhythm('beat', numerator, beatRhythm);
    case 'div':
      return divRhythm = divRhythm < 1 ? t.RhythmPattern.random(divsPerDiv, 0) : rhythm('div', divsPerDiv, divRhythm);
    case 'subdiv':
      return subdivRhythm = subdivRhythm < 1 ? t.RhythmPattern.random(subdivsPerDiv, 0) : rhythm('subdiv', subdivsPerDiv, subdivRhythm)
    default:throw new Error('Invalid level provided to setRhythm');
  }
}

setTuningAndInstruments=()=>{  
  p(c, ...['control_c', 'program_c'].flatMap(type=>[ ...source.map(ch=>({
  type, vals:[ch, ...(ch.toString().startsWith('leftCH') ? (type==='control_c' ? [10, 0] : [primaryInstrument]) : (type==='control_c' ? [10, 127] : [primaryInstrument]))]})),
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH1, ...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH2, ...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));  };
trackBeatRhythm=()=>{beatCount++; if (beatRhythm[beatIndex] > 0) {beatsOn++; beatsOff=0;} else {beatsOn=0; beatsOff++;}};
trackDivRhythm=()=>{if (divRhythm[divIndex] > 0) {divsOn++; divsOff=0;} else {divsOn=0; divsOff++;}
};

setTertiaryInstruments=()=>{
  if (m.random() < .3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) {
p(c, ...['control_c'].flatMap(()=>{ _={ tick:beatStart, type:'program_c' };
  return [
    ...reflectionBinaural.map(ch=>({..._,vals:[ch, tertiaryInstruments[ri(tertiaryInstruments.length - 1)]]})),
  ];  })  );  }
}

setBinaural=()=>{
  if (beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) {  beatCount=0; flipBinaural=!flipBinaural;
    beatsUntilBinauralShift=ri(numerator * meterRatio, 7);
    binauralFreqOffset=rf(m.max(BINAURAL.min, binauralFreqOffset - 1), m.min(BINAURAL.max, binauralFreqOffset + 1));  }
    allNotesOff(beatStart);
    p(c, ...binauralL.map(ch=>({tick:beatStart, type:'pitch_bend_c', vals:[ch, ch===leftCH1 || ch===leftCH3 ? (flipBinaural ? binauralMinus : binauralPlus) : (flipBinaural ? binauralPlus : binauralMinus)]})), 
    ...binauralR.map(ch=>({tick:beatStart, type:'pitch_bend_c', vals:[ch, ch===rightCH1 || ch===rightCH3 ? (flipBinaural ? binauralPlus : binauralMinus) : (flipBinaural ? binauralMinus : binauralPlus)]})));
};

setBalanceAndFX=()=>{
if (m.random() < .3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop<1 ) { firstLoop=1; 
  p(c, ...['control_c'].flatMap(()=>{
  balanceOffset=ri(m.max(0, balanceOffset - 7), m.min(45, balanceOffset + 7));
  sideBias=ri(m.max(-15, sideBias - 5), m.min(15, sideBias + 5));
  leftBalance=m.min(0,m.max(56, balanceOffset + ri(7) + sideBias));
  rightBalance=m.max(127,m.min(72, 127 - balanceOffset - ri(7) + sideBias));
  centerBalance=m.min(96,(m.max(32, 64 + m.round(rv(balanceOffset / ri(2,3))) * (m.random() < .5 ? -1 : 1) + sideBias)));
  reflectionVariation=ri(1,10); centerBalance2=m.random()<.5?centerBalance+m.ceil(reflectionVariation*.5) : centerBalance+m.floor(reflectionVariation * .5 * -1);
  _={ tick:beatStart, type:'control_c' };
return [
    ...source.map(ch=>({..._,vals:[ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance : rightBalance) : ch.toString().startsWith('rightCH') ? (flipBinaural ? rightBalance : leftBalance) : centerBalance]})),
    ...reflection.map(ch=>({..._,vals:[ch, 10, ch.toString().startsWith('leftCH') ? (flipBinaural ? leftBalance+reflectionVariation : rightBalance-reflectionVariation) : ch.toString().startsWith('rightCH') ? (flipBinaural ? rightBalance-reflectionVariation : leftBalance+reflectionVariation) : centerBalance2+m.round((rf(-.5,.5)*reflectionVariation)) ]})),
    ...source.map(ch=>({..._,vals:[ch, 1, ch===centerCH1 ? ri(10) : ri(60)]})),
    ...source.map(ch=>({..._,vals:[ch, 5, ri(88)]})),
    ...source.map(ch=>({..._,vals:[ch, 11, ch===centerCH1 ? ri(115,127) : ri(64,127)]})),
    ...source.map(ch=>({..._,vals:[ch, 65, ri(1)]})),
    ...source.map(ch=>({..._,vals:[ch, 66, ri(20)]})),
    ...source.map(ch=>({..._,vals:[ch, 67, ri(64)]})),
    ...source.map(ch=>({..._,vals:[ch, 91, ri(33)]})),
    ...source.map(ch=>({..._,vals:[ch, 93, ri(33)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 1, ch===centerCH2 ? ri(15) : ri(90)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 5, ri(127)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 11, ch===centerCH2 ? ri(66,99) : ri(77,111)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 65, ri(1)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 66, ri(77)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 67, ri(32)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 91, ch===centerCH2 ? ri(32) : ri(77)]})),
    ...reflection.map(ch=>({..._,vals:[ch, 93, ch===centerCH2 ? ri(32) : ri(77)]})),
  ];  })  );  }
}

crossModulateRhythms=()=>{ crossModulation=0;
  crossModulation += rf(1.5,(beatRhythm[beatIndex] > 0 ? 3 : m.min(rf(.75,1.5), 3 / numerator + beatsOff * (1 / numerator)))) + 
  rf(1,(divRhythm[divIndex] > 0 ? 2 : m.min(rf(.5,1), 2 / divsPerBeat + divsOff * (1 / divsPerBeat)))) + 
  rf(.5,(subdivRhythm[subdivIndex] > 0 ? 1 : m.min(rf(.25,.5), 1 / subdivsPerDiv + subdivsOff * (1 / subdivsPerDiv)))) + 
  (subdivsOn < ri(15,21) ? rf(.1,.3) : 0) + (subdivsOff > ri(3) ? rf(.1,.3) : 0) + 
  (divsOn < ri(9,15) ? rf(.1,.3) : 0) + (divsOff > ri(3,12) ? rf(.1,.3) : 0) + 
  (beatsOn < ri(3) ? rf(.1,.3) : 0) + (beatsOff > ri(2) ? rf(.1,.3) : 0);
};

setNoteParams=()=>{
  subdivsOn++; subdivsOff=0;
  on=subdivStart + rv(ticksPerSubdiv * rf(1/3), [-.01, .07], .3);
  shorterSustain=rv(rf(m.max(ticksPerDiv * .5, ticksPerDiv / subdivsPerDiv), (ticksPerBeat * (.3 + m.random() * .7))), [.1, .2], [-.05, -.1], .1);
  longerSustain=rv(rf(ticksPerDiv * .8, (ticksPerBeat * (.3 + m.random() * .7))), [.1, .3], [-.05, -.1], .1);
  sustain=(useShorterSustain ? shorterSustain : longerSustain) * rv(rf(.8, 1.3));
  binauralVelocity=rv(velocity * rf(.35, .5));
};

playNotes=()=>{if (crossModulation>rf(2,4)) {subdivsOff=0; subdivsOn++;
  composer.getNotes().forEach(({ note })=>{  events=source.map(sourceCH=>{
    CHsToPlay=flipBinaural ? flipBinauralT.includes(sourceCH) : flipBinauralF.includes(sourceCH);
    if (CHsToPlay) {  reflectionCH = reflect[sourceCH];  x=[
    {tick: sourceCH===centerCH1 ? on + rv(ticksPerSubdiv*rf(1/9),[-.1,.1],.3) : on + rv(ticksPerSubdiv*rf(1/3),[-.1,.1],.3), type: 'note_on_c', vals: [sourceCH, note, sourceCH===centerCH1 ? velocity * rf(.9, 1.1) : binauralVelocity * rf(.95, 1.03)]},
    {tick: on + sustain * (sourceCH===centerCH1 ? 1 : rv(rf(.92, 1.03))), vals: [sourceCH, note]},
  
    {tick: reflectionCH===centerCH2 ? on + rv(ticksPerSubdiv*rf(.2),[-.01,.1],.5) : on + rv(ticksPerSubdiv*rf(1/3),[-.01,.1],.5), type: 'note_on_c', vals: [reflectionCH, note, reflectionCH===centerCH2 ? velocity * rf(.5, .8) : binauralVelocity * rf(.55, .9)]},
    {tick: on + sustain * (reflectionCH===centerCH2 ? rf(.7,1.2) : rv(rf(.65, 1.3))), vals: [reflectionCH, note]}
  ]; return x; } else { return null; }  }).filter(_=>_!==null).flat();
    p(c, ...events);  });  } else { subdivsOff++; subdivsOn=0; }
};

p=pushMultiple=(array,...items)=>{  array.push(...items);  };  c=csvRows=[];

logUnit=(type)=>{  let shouldLog=false;
  if (LOG==='none') shouldLog=false;
  else if (LOG==='all') shouldLog=true;
  else {  const logList=LOG.split(',').map(item=>item.trim());
    shouldLog=logList.length===1 ? logList[0]===type : logList.includes(type);  }
  if (!shouldLog) return null;  let meterInfo='';
  if (type==='measure') {
    thisUnit=measureIndex + 1;
    unitsPerParent=totalMeasures;
    startTime=measureStartTime;
    ticksPerSecond=midiBPM * PPQ / 60;
    secondsPerMeasure=ticksPerMeasure / (midiBPM * PPQ / 60);
    endTime=measureStartTime + secondsPerMeasure;
    startTick=measureStart;
    endTick=measureStart + ticksPerMeasure;
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
    setTiming();
  } else if (type==='beat') {
    thisUnit=beatIndex + 1;
    unitsPerParent=numerator;
    startTime=measureStartTime + beatIndex * secondsPerBeat;
    endTime=startTime + secondsPerBeat;
    startTick=beatStart;
    endTick=startTick + ticksPerBeat;
    secondsPerDiv=secondsPerBeat / divsPerBeat;
  } else if (type==='division') {
    thisUnit=divIndex + 1;
    unitsPerParent=divsPerBeat;
    startTime=measureStartTime + beatIndex * secondsPerBeat + divIndex * secondsPerDiv;
    endTime=startTime + secondsPerDiv;
    startTick=divStart;
    endTick=startTick + ticksPerDiv;
    secondsPerSubdiv=secondsPerDiv / subdivsPerDiv;
  } else if (type==='subdivision') {
    thisUnit=subdivIndex + 1;
    unitsPerParent=subdivsPerDiv;
    startTime=measureStartTime + beatIndex * secondsPerBeat + divIndex * secondsPerDiv + subdivIndex * secondsPerSubdiv;
    endTime=startTime + secondsPerSubdiv;
    startTick=subdivStart;
    endTick=startTick + ticksPerSubdiv;
  }
  finalTime=formatTime(endTime + SILENT_OUTRO_SECONDS);
  return (()=>{  c.push({
    tick:startTick,type:'marker_t',vals:[`${type.charAt(0).toUpperCase() + type.slice(1)} ${thisUnit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  });  })();
};
