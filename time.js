getMidiMeter=()=>{
  meterRatio=numerator / denominator;
  isPowerOf2=(n)=>{ return (n & (n - 1))===0; }
  if (isPowerOf2(denominator)) { midiMeter=[numerator,denominator]; }
  else {
    const high=2 ** m.ceil(m.log2(denominator));  const highRatio=numerator / high;
    const low=2 ** m.floor(m.log2(denominator));  const lowRatio=numerator / low;
    midiMeter=m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio) ? [numerator,high] : [numerator,low];
  }
  midiMeterRatio=midiMeter[0] / midiMeter[1];
  syncFactor=midiMeterRatio / meterRatio;
  midiBPM=BPM * syncFactor;
  tpSec=midiBPM * PPQ / 60;
  tpMeasure=PPQ * 4 * midiMeterRatio;
  setMidiTiming(); 
  return;
};

getPolyrhythm=()=>{  while (true) {
  [polyNumerator,polyDenominator]=composer.getMeter(true,true);
  polyMeterRatio=polyNumerator / polyDenominator;
  let allMatches=[]; let bestMatch={
    originalMeasures: Infinity,
    polyMeasures: Infinity,
    totalMeasures: Infinity,
    polyNumerator: polyNumerator,
    polyDenominator: polyDenominator
  };
  for (let originalMeasures=1; originalMeasures < 6; originalMeasures++) {
    for (let polyMeasures=1; polyMeasures < 6; polyMeasures++) {
      if (m.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
        let currentMatch={
          originalMeasures: originalMeasures,
          polyMeasures: polyMeasures,
          totalMeasures: originalMeasures + polyMeasures,
          polyNumerator: polyNumerator,
          polyDenominator: polyDenominator
        };
        allMatches.push(currentMatch);
        if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
          bestMatch=currentMatch;
        }
      }
    }
  }
  if (bestMatch.totalMeasures !== Infinity && (bestMatch.totalMeasures > 2 && (bestMatch.originalMeasures > 1 || bestMatch.polyMeasures > 1)) && (numerator !== polyNumerator || denominator !== polyDenominator)) {
    measuresPerPhrase1=bestMatch.originalMeasures;
    measuresPerPhrase2=bestMatch.polyMeasures;
    tpPhrase=tpMeasure * measuresPerPhrase1;
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
    spSection=tpSection / tpSec;
    endTick=startTick + tpSection;
    startTime=sectionStartTime;
    endTime=startTime + spSection;
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
    endTick=startTick + tpPhrase;
    startTime=phraseStartTime;
    spPhrase=tpPhrase / tpSec;
    endTime=startTime + spPhrase;
  } else if (type==='measure') {
    unit=measureIndex + 1;
    unitsPerParent=measuresPerPhrase;
    startTick=measureStart;
    endTick=measureStart + tpMeasure;
    startTime=measureStartTime;
    endTime=measureStartTime + spMeasure;
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
    actualMeter=[numerator,denominator];
    meterInfo=midiMeter[1]===actualMeter[1] ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails}` : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails}`;
  } else if (type==='beat') {
    unit=beatIndex + 1;
    unitsPerParent=numerator;
    startTick=beatStart;
    endTick=startTick + tpBeat;
    startTime=beatStartTime;
    endTime=startTime + spBeat;
  } else if (type==='division') {
    unit=divIndex + 1;
    unitsPerParent=divsPerBeat;
    startTick=divStart;
    endTick=startTick + tpDiv;
    startTime=divStartTime;
    endTime=startTime + spDiv;
  } else if (type==='subdivision') {
    unit=subdivIndex + 1;
    unitsPerParent=subdivsPerDiv;
    startTick=subdivStart;
    endTick=startTick + tpSubdiv;
    startTime=subdivStartTime;
    endTime=startTime + spSubdiv;
  } else if (type==='subsubdivision') {
    unit=subsubdivIndex + 1;
    unitsPerParent=subsubdivsPerSubdiv;
    startTick=subsubdivStart;
    endTick=startTick + tpSubsubdiv;
    startTime=subsubdivStartTime;
    endTime=startTime + spSubsubdiv;
  }  return (()=>{  c.push({
    tick:startTick,type:'marker_t',vals:[`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
  });  })();
};

nextSection=()=>{ allNotesOff('sectionStart');
  sectionStart+=tpSection; sectionStartTime+=spSection;
  finalTime=formatTime(sectionStartTime+SILENT_OUTRO_SECONDS);
  tpSection=spSection=0;
};
nextPhrase=()=>{ phraseStart+=tpPhrase; phraseStartTime+=spPhrase;
  tpSection+=tpPhrase; spSection+=spPhrase;
};
setMeasureTiming=()=>{ tpMeasure=tpPhrase / measuresPerPhrase;
  spMeasure=tpMeasure / tpSec;
  measureStart=phraseStart+measureIndex*tpMeasure;
  measureStartTime=phraseStartTime+measureIndex*spMeasure;
};
setBeatTiming=()=>{ tpBeat=tpMeasure / numerator;
  spBeat=tpBeat / tpSec;
  trueBPM=60 / spBeat; bpmRatio=BPM / trueBPM; bpmRatio2=trueBPM / BPM;
  trueBPM2=numerator * (numerator / denominator) / 4; bpmRatio3=1/trueBPM2;
  beatStart=phraseStart + measureIndex * tpMeasure + beatIndex * tpBeat;  beatStartTime=measureStartTime + beatIndex * spBeat;
  divsPerBeat=composer.getDivisions(); 
};
setDivTiming=()=>{ tpDiv=tpBeat / m.max(1,divsPerBeat);
  spDiv=tpDiv / tpSec;
  divStart=beatStart + divIndex * tpDiv;
  divStartTime=beatStartTime + divIndex * spDiv;
  subdivsPerDiv=composer.getSubdivisions();
  subdivFreq=subdivsPerDiv * divsPerBeat * numerator * meterRatio;
};
setSubdivTiming=()=>{ tpSubdiv=tpDiv / m.max(1,subdivsPerDiv);
  spSubdiv=tpSubdiv / tpSec;
  subdivsPerMinute=60 / spSubdiv;
  subdivStart=divStart + subdivIndex * tpSubdiv;
  subdivStartTime=divStartTime + subdivIndex * spSubdiv;
  subsubdivsPerSub=composer.getSubsubdivs();
};
setSubsubdivTiming=()=>{ tpSubsubdiv=tpSubdiv / m.max(1,subsubdivsPerSubdiv);
  spSubsubdiv=tpSubsubdiv / tpSec;
  subsubdivsPerMinute=60 / spSubsubdiv;
  subsubdivStart=subdivStart + subsubdivIndex * tpSubsubdiv;
  subsubdivStartTime=subdivStartTime + subsubdivIndex * spSubsubdiv;
};

setMidiTiming=()=>{  p(c, { tick:sectionStart,type:'bpm',vals:[midiBPM] },
  { tick:sectionStart,type:'meter',vals:[midiMeter[0],midiMeter[1]] });  };

formatTime=(seconds)=>{ 
  const minutes=m.floor(seconds / 60); seconds=(seconds % 60).toFixed(4).padStart(7,'0');
  return `${minutes}:${seconds}`;
};
