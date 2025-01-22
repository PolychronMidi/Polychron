require('./sheet'); require('./venue'); require('./backstage'); require('./rhythm'); require('./composers');
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
  ticksPerSecond=midiBPM * PPQ / 60;
  setTiming(); 
  return;
};

makePolyrhythm=()=>{
  [polyNumerator,polyDenominator]=composer.getMeter()
  polyMeterRatio = polyNumerator / polyDenominator;
  let allMatches = [];
  bestMatch = {
    originalMeasures: Infinity,
    polyMeasures: Infinity,
    totalMeasures: Infinity,
    polyNumerator: polyNumerator,
    polyDenominator: polyDenominator
  };
  for (let originalMeasures = 1; originalMeasures <= 7; originalMeasures++) {
    for (let polyMeasures = 1; polyMeasures <= 7; polyMeasures++) {
      if (Math.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
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
  if (bestMatch.totalMeasures===Infinity) {
    return makePolyrhythm();
  }
  measuresPerPhrase1=bestMatch.originalMeasures;
  measuresPerPhrase2=bestMatch.polyMeasures;
  return;
};

p=pushMultiple=(array,...items)=>{  array.push(...items);  };  
c=csvRows=[];

logUnit=(type)=>{  let shouldLog=false;
  if (LOG==='none') shouldLog=false;
  else if (LOG==='all') shouldLog=true;
  else {  const logList=LOG.split(',').map(item=>item.trim());
    shouldLog=logList.length===1 ? logList[0]===type : logList.includes(type);  }
  if (!shouldLog) return null;  let meterInfo='';
  if (type==='measure') {
    unit=measureIndex + 1;
    unitsPerParent=measuresPerPhrase;
    startTime=measureStartTime;
    secondsPerMeasure=ticksPerMeasure / ticksPerSecond;
    secondsPerPhrase=ticksPerPhrase / ticksPerSecond;
    endTime=measureStartTime + secondsPerMeasure;
    startTick=measureStartTick;
    endTick=measureStartTick + ticksPerMeasure;
    actualMeter=[numerator, denominator];
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
    meterInfo=midiMeter[1]===actualMeter[1] ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails}` : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails}`;
  } else if (type==='beat') {
    unit=beatIndex + 1;
    unitsPerParent=numerator;
    startTime=measureStartTime + beatIndex * secondsPerBeat;
    endTime=startTime + secondsPerBeat;
    startTick=beatStart;
    endTick=startTick + ticksPerBeat;
    secondsPerDiv=secondsPerBeat / divsPerBeat;
  } else if (type==='division') {
    unit=divIndex + 1;
    unitsPerParent=divsPerBeat;
    startTime=measureStartTime+beatIndex*secondsPerBeat+divIndex*secondsPerDiv;
    endTime=startTime + secondsPerDiv;
    startTick=divStart;
    endTick=startTick + ticksPerDiv;
    secondsPerSubdiv=secondsPerDiv / subdivsPerDiv;
  } else if (type==='subdivision') {
    unit=subdivIndex + 1;
    unitsPerParent=subdivsPerDiv;
    startTime=measureStartTime+beatIndex*secondsPerBeat+divIndex*secondsPerDiv+subdivIndex*secondsPerSubdiv;
    endTime=startTime + secondsPerSubdiv;
    startTick=subdivStart;
    endTick=startTick + ticksPerSubdiv;
  }
  return (()=>{  c.push({
    tick:startTick,type:'marker_t',vals:[`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  });  })();
};

setTuningAndInstruments=()=>{  
  p(c, ...['control_c', 'program_c'].flatMap(type=>[ ...source.map(ch=>({
  type, vals:[ch, ...(ch.toString().startsWith('leftCH') ? (type==='control_c' ? [10, 0] : [primaryInstrument]) : (type==='control_c' ? [10, 127] : [primaryInstrument]))]})),
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH1, ...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
  { type:type==='control_c' ? 'pitch_bend_c' : 'program_c', vals:[centerCH2, ...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));  
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
  crossModulation += rf(1.5,(beatRhythm[beatIndex] > rf(-.1) ? 3 : m.min(rf(.75,1.5), 3 / numerator + beatsOff * (1 / numerator)))) + 
  rf(1,(divRhythm[divIndex] > rf(-.1) ? 2 : m.min(rf(.5,1), 2 / divsPerBeat + divsOff * (1 / divsPerBeat)))) + 
  rf(.5,(subdivRhythm[subdivIndex] > rf(-.1) ? 1 : m.min(rf(.25,.5), 1 / subdivsPerDiv + subdivsOff * (1 / subdivsPerDiv)))) + 
  (subdivsOn < ri(7,15) ? rf(.1,.3) : rf(-.1)) + (subdivsOff > ri(1) ? rf(.1,.3) : rf(-.1)) + 
  (divsOn < ri(9,15) ? rf(.1,.3) : rf(-.1)) + (divsOff > ri(3,7) ? rf(.1,.3) : rf(-.1)) + 
  (beatsOn < ri(3) ? rf(.1,.3) : rf(-.1)) + (beatsOff > ri(3) ? rf(.1,.3) : rf(-.1));
};

setNoteParams=()=>{
  on=subdivStart + rv(ticksPerSubdiv * rf(1/3), [-.01, .07], .3);
  shorterSustain=rv(rf(m.max(ticksPerDiv*.5,ticksPerDiv / subdivsPerDiv),(ticksPerBeat*(.3+m.random()*.7))),[.1,.2],[-.05,-.1],.1);
  longerSustain=rv(rf(ticksPerDiv*.8,(ticksPerBeat*(.3+m.random()*.7))),[.1,.3],[-.05,-.1],.1);
  useShorterSustain=subdivFreq > ri(100,150);
  sustain=(useShorterSustain ? shorterSustain : longerSustain)*rv(rf(.8,1.3));
  binauralVelocity=rv(velocity * rf(.35, .5));
}

playNotes=()=>{ setNoteParams(); crossModulateRhythms()
  if (crossModulation>rf(3.5,4)) {subdivsOff=0; subdivsOn++;
  composer.getNotes().forEach(({ note })=>{  events=source.map(sourceCH=>{
    CHsToPlay=flipBinaural ? flipBinauralT.includes(sourceCH) : flipBinauralF.includes(sourceCH);
    if (CHsToPlay) {  reflectionCH = reflect[sourceCH];  x=[
    {tick:sourceCH===centerCH1 ? on + rv(ticksPerSubdiv*rf(1/9),[-.1,.1],.3) : on + rv(ticksPerSubdiv*rf(1/3),[-.1,.1],.3),type:'note_on_c',vals:[sourceCH,note,sourceCH===centerCH1 ? velocity*rf(.9,1.1) : binauralVelocity*rf(.95,1.03)]},
    {tick:on+sustain*(sourceCH===centerCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,note]},
  
    {tick:reflectionCH===centerCH2 ? on+rv(ticksPerSubdiv*rf(.2),[-.01,.1],.5) : on+rv(ticksPerSubdiv*rf(1/3),[-.01,.1],.5),type:'note_on_c',vals:[reflectionCH,note,reflectionCH===centerCH2 ? velocity*rf(.5,.8) : binauralVelocity*rf(.55,.9)]},
    {tick:on+sustain*(reflectionCH===centerCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,note]}
  ]; return x; } else { return null; }  }).filter(_=>_!==null).flat();
    p(c, ...events);  });  } else { subdivsOff++; subdivsOn=0; }
};
