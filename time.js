getMidiMeter=()=>{
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
  ticksPerSecond=midiBPM * PPQ / 60;
  ticksPerMeasure=PPQ * 4 * midiMeterRatio;
  setMidiTiming(); 
  return;
};

getPolyrhythm = () => {  while (true) {
  [polyNumerator, polyDenominator] = composer.getMeter(true,true);
  polyMeterRatio = polyNumerator / polyDenominator;
  let allMatches = []; let bestMatch = {
    originalMeasures: Infinity,
    polyMeasures: Infinity,
    totalMeasures: Infinity,
    polyNumerator: polyNumerator,
    polyDenominator: polyDenominator
  };
  for (let originalMeasures = 1; originalMeasures < 6; originalMeasures++) {
    for (let polyMeasures = 1; polyMeasures < 6; polyMeasures++) {
      if (m.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
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
  if (bestMatch.totalMeasures !== Infinity && (bestMatch.totalMeasures > 2 && (bestMatch.originalMeasures > 1 || bestMatch.polyMeasures > 1)) && (numerator !== polyNumerator || denominator !== polyDenominator)) {
    measuresPerPhrase1 = bestMatch.originalMeasures;
    measuresPerPhrase2 = bestMatch.polyMeasures;
    ticksPerPhrase = ticksPerMeasure * measuresPerPhrase1;
    return;
  }
}
};

logUnit=(type)=>{  let shouldLog=false;
  type=type.toLowerCase();
  if (LOG==='none') shouldLog=false;
  else if (LOG==='all') shouldLog=true;
  else {  const logList=LOG.split(',').map(item=>item.trim());
    shouldLog=logList.length===1 ? logList[0]===type : logList.includes(type);  }
  if (!shouldLog) return null;  let meterInfo='';
  if (type==='section') {
    unit=sectionIndex + 1;
    unitsPerParent=totalSections;
    startTick=sectionStart;
    secondsPerSection=ticksPerSection / ticksPerSecond;
    endTick=startTick + ticksPerSection;
    startTime=sectionStartTime;
    endTime=startTime + secondsPerSection;
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
  } else if (type==='phrase') {
    unit=phraseIndex + 1;
    unitsPerParent=phrasesPerSection;
    startTick=phraseStart;
    endTick=startTick + ticksPerPhrase;
    startTime=phraseStartTime;
    secondsPerPhrase=ticksPerPhrase / ticksPerSecond;
    endTime=startTime + secondsPerPhrase;
  } else if (type==='measure') {
    unit=measureIndex + 1;
    unitsPerParent=measuresPerPhrase;
    startTick=measureStart;
    endTick=measureStart + ticksPerMeasure;
    startTime=measureStartTime;
    endTime=measureStartTime + secondsPerMeasure;
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
    actualMeter=[numerator, denominator];
    meterInfo=midiMeter[1]===actualMeter[1] ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails}` : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails}`;
  } else if (type==='beat') {
    unit=beatIndex + 1;
    unitsPerParent=numerator;
    startTick=beatStart;
    endTick=startTick + ticksPerBeat;
    startTime=beatStartTime;
    endTime=startTime + secondsPerBeat;
  } else if (type==='division') {
    unit=divIndex + 1;
    unitsPerParent=divsPerBeat;
    startTick=divStart;
    endTick=startTick + ticksPerDiv;
    startTime=divStartTime;
    endTime=startTime + secondsPerDiv;
  } else if (type==='subdivision') {
    unit=subdivIndex + 1;
    unitsPerParent=subdivsPerDiv;
    startTick=subdivStart;
    endTick=startTick + ticksPerSubdiv;
    startTime=subdivStartTime;
    endTime=startTime + secondsPerSubdiv;
  }
  return (()=>{  c.push({
    tick:startTick,type:'marker_t',vals:[`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  });  })();
};

nextSection=()=>{ allNotesOff('sectionStart');
  sectionStart+=ticksPerSection; sectionStartTime+=secondsPerSection;
  finalTime=formatTime(sectionStartTime+SILENT_OUTRO_SECONDS);
  ticksPerSection=secondsPerSection=0;
};
nextPhrase=()=>{ phraseStart+=ticksPerPhrase; phraseStartTime+=secondsPerPhrase;
  ticksPerSection+=ticksPerPhrase; secondsPerSection+=secondsPerPhrase;
};
setMeasureTiming=()=>{ ticksPerMeasure=ticksPerPhrase / measuresPerPhrase;
  secondsPerMeasure=ticksPerMeasure / ticksPerSecond;
  measureStart=phraseStart+measureIndex*ticksPerMeasure;
  measureStartTime=phraseStartTime+measureIndex*secondsPerMeasure;
};
setBeatTiming=()=>{ ticksPerBeat=ticksPerMeasure / numerator;
  secondsPerBeat=ticksPerBeat / ticksPerSecond;
  trueBPM=60 / secondsPerBeat; bpmRatio=BPM / trueBPM; bpmRatio2=trueBPM / BPM;
  trueBPM2=numerator * (numerator / denominator) / 4;
  beatStart=phraseStart + measureIndex * ticksPerMeasure + beatIndex * ticksPerBeat;  beatStartTime=measureStartTime + beatIndex * secondsPerBeat;
  divsPerBeat=composer.getDivisions(); 
};
setDivTiming=()=>{ ticksPerDiv=ticksPerBeat / m.max(1,divsPerBeat);
  secondsPerDiv=ticksPerDiv / ticksPerSecond;
  divStart=beatStart + divIndex * ticksPerDiv;
  divStartTime=beatStartTime + divIndex * secondsPerDiv;
  subdivsPerDiv=composer.getSubdivisions();
  subdivFreq=subdivsPerDiv * divsPerBeat * numerator * meterRatio;
};
setSubdivTiming=()=>{ ticksPerSubdiv=ticksPerDiv / m.max(1,subdivsPerDiv);
  secondsPerSubdiv=ticksPerSubdiv / ticksPerSecond;
  subdivsPerMinute=60 / secondsPerSubdiv;
  subdivStart=divStart + subdivIndex * ticksPerSubdiv;
  subdivStartTime=divStartTime + subdivIndex * secondsPerSubdiv;
};

setMidiTiming=()=>{  p(c,  { tick:sectionStart, type:'bpm', vals:[midiBPM] },
  { tick:sectionStart, type:'meter', vals:[midiMeter[0], midiMeter[1]] });  };

formatTime=(seconds)=>{ 
  const minutes=m.floor(seconds / 60); seconds=(seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};
