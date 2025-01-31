p=pushMultiple=(array,...items)=>{  array.push(...items);  };  
c=csvRows=[];
m=Math;
// Random float(decimal) inclusive of min(s) & max(s). If only one number given,max=number & min=0.
rf=randomFloat=(min1=1,max1,min2,max2)=>{
  if (max1===undefined) { max1=min1; min1=0; }
  [min1,max1]=[m.min(min1,max1),m.max(min1,max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2,max2]=[m.min(min2,max2),m.max(min2,max2)];
    const range1=max1-min1; const range2=max2-min2;
    const totalRange=range1+range2; const rand=m.random()*totalRange;
    if (rand < range1) { return m.random()*(range1+Number.EPSILON)+min1;
    } else { return m.random()*(range2+Number.EPSILON)+min2; }
  } else { return m.random()*(max1-min1+Number.EPSILON)+min1; }
};

clamp=(value,min,max)=>m.min(m.max(value,min),max);
circularClamp=(value,min,max)=>{
  const range=max - min + 1;
  return ((value - min) % range + range) % range + min;
};
metaClamp=(value,base,lowerScale,upperScale,minBound=2,maxBound=9)=>{
  const lowerBound=m.max(minBound,m.floor(base * lowerScale));
  const upperBound=m.min(maxBound,m.ceil(base * upperScale));
  return clamp(value,lowerBound,upperBound);
};

// Random integer(whole number) inclusive of min(s) & max(s). If only one number given,max=number & min=0. Although result is rounded,providing decimals in the range allows for more precision.
ri=randomInt=(min1=1,max1,min2,max2)=>{
  if (max1===undefined) { max1=min1; min1=0; }
  [min1,max1]=[m.min(min1,max1),m.max(min1,max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2,max2]=[m.min(min2,max2),m.max(min2,max2)];
    const range1=max1-min1; const range2=max2-min2;
    const totalRange=range1+range2; const rand=rf()*totalRange;
    if (rand < range1) { 
      return clamp(m.round(rf() * range1 + min1),m.ceil(min1),m.floor(max1));
    } else {
      return clamp(m.round(rand - range1 + min2),m.ceil(min2),m.floor(max2));
    }
  } else {
    return clamp(m.round(rf() * (max1 - min1) + min1),m.ceil(min1),m.floor(max1));
  }
};

// Random limited increment: random value from inclusive range,with limited change per iteration.
rl=randomLimitedIncrement=(currentValue,minChange,maxChange,minValue,maxValue,type='i')=>{
  const adjustedMinChange=m.min(minChange,maxChange);
  const adjustedMaxChange=m.max(minChange,maxChange);
  const newMin=m.max(minValue,currentValue + adjustedMinChange);
  const newMax=m.min(maxValue,currentValue + adjustedMaxChange);
  return type==='f' ? rf(newMin,newMax) : ri(newMin,newMax);
};

// Use rl & nested structure in Map to store & increment effect values for each channel & effect type.
rlFX=(ch,effectNum,minValue,maxValue,condition=null,conditionMin=null,conditionMax=null)=>{
  chFX=new Map();
  if (!chFX.has(ch)) {
    chFX.set(ch,{});
  }
  const chFXMap=chFX.get(ch);
  if (!(effectNum in chFXMap)) {
    chFXMap[effectNum]=clamp(0,minValue,maxValue);
  }
  const midiEffect={
    getValue: ()=>{
      let effectValue=chFXMap[effectNum];
      let newMin=minValue,newMax=maxValue;
      if (condition !== null && typeof condition==='function' && condition(ch)) {
        newMin=conditionMin;
        newMax=conditionMax;
        effectValue=clamp(rl(effectValue,-15,15,newMin,newMax),newMin,newMax);
      } else {
        effectValue=clamp(rl(effectValue,-15,15,newMin,newMax),newMin,newMax);
      }
      chFXMap[effectNum]=effectValue;
      return effectValue;
    }
  };
  return {..._,vals: [ch,effectNum,midiEffect.getValue()]};
};

// Random variation within range(s) at frequency: give one range or a separate boost & deboost range.
rv=randomVariation=(value,boostRange=[.05,.10],deboostRange=boostRange,frequency=.05)=>{let factor;
  const singleRange=Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange=singleRange.length===2 && typeof singleRange[0]==='number' && typeof singleRange[1]==='number';
  if (isSingleRange) {  const variation=rf(...singleRange);
    factor=rf() < frequency ? 1 + variation : 1;
  } else {  const range=rf() < .5 ? boostRange : deboostRange;
    factor=rf() < frequency ? 1 + rf(...range) : 1;  }
  return value * factor;
};

// Random weighted selection: any sized list of weights with any values are normalized to fit inclusive range.
rw=randomWeightedSelection=(min,max,weights)=>{
  const range=max - min + 1;
  let effectiveWeights=weights.map(weight=>weight * (1 + rf(-0.3,0.3)));
  if (effectiveWeights.length !== range) {
    if (effectiveWeights.length < range) {
      const newWeights=[];
      for (let i=0; i < range; i++) {
        const fraction=i / (range - 1);
        const lowerIndex=m.floor(fraction * (effectiveWeights.length - 1));
        const upperIndex=m.min(lowerIndex + 1,effectiveWeights.length - 1);
        const weightDiff=effectiveWeights[upperIndex] - effectiveWeights[lowerIndex];
        const interpolatedWeight=effectiveWeights[lowerIndex] + (fraction * (effectiveWeights.length - 1) - lowerIndex) * weightDiff;
        newWeights.push(interpolatedWeight);
      }
      effectiveWeights=newWeights;
    } else {
      const groupSize=m.floor(effectiveWeights.length / range);
      effectiveWeights=Array(range).fill(0).map((_,i)=>{
        const startIndex=i * groupSize;
        const endIndex=m.min(startIndex + groupSize,effectiveWeights.length);
        return effectiveWeights.slice(startIndex,endIndex).reduce((sum,w)=>sum + w,0) / (endIndex - startIndex);
      });
    }
  }
  const totalWeight=effectiveWeights.reduce((acc,w)=>acc + w,0);
  const normalizedWeights=effectiveWeights.map(w=>w / totalWeight);
  let random=rf();
  for (let i=0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
}

flipBinaural=false;
velocity=99;
measureCount=secondsPerMeasure=subdivStart=beatStart=divStart=sectionStart=sectionStartTime=ticksPerSection=secondsPerSection=finalTick=divsPerBeat=bestMatch=polyMeterRatio=polyNumerator=ticksPerSecond=finalTime=endTime=phraseStart=ticksPerPhrase=phraseStartTime=secondsPerPhrase=measuresPerPhrase1=measuresPerPhrase2=subdivsPerMinute=numerator=meterRatio=divsPerDiv=subdivsPerDiv=measureStart=measureStartTime=beatsUntilBinauralShift=beatCount=beatsOn=beatsOff=divsOn=divsOff=subdivsOn=subdivsOff=noteCount=beatRhythm=divRhythm=subdivRhythm=balanceOffset=sideBias=firstLoop=side=0;

neutralPitchBend=8192; semitone=neutralPitchBend / 2;
centsToTuningFreq=1200 * m.log2(TUNING_FREQ / 440);
tuningPitchBend=m.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

binauralFreqOffset=rf(BINAURAL.min,BINAURAL.max);
binauralOffset=(plusOrMinus)=>m.round(tuningPitchBend + semitone * (12 * m.log2((TUNING_FREQ + plusOrMinus * binauralFreqOffset) / TUNING_FREQ)));
[binauralPlus,binauralMinus]=[1,-1].map(binauralOffset);

centerCH1=0;centerCH2=1;leftCH1=2;rightCH1=3; leftCH3=4; rightCH3=5; leftCH2=6; rightCH2=7; leftCH4=8; drumCH=9; rightCH4=10; centerCH3=11; leftCH5=12; rightCH5=13; leftCH6=14; rightCH6=15;
bass=[centerCH3,leftCH5,rightCH5,leftCH6,rightCH6];
bassBinaural=[leftCH5,rightCH5,leftCH6,rightCH6];
source=[centerCH1,leftCH1,leftCH2,rightCH1,rightCH2];
source2=[centerCH1,leftCH1,leftCH2,rightCH1,rightCH2,drumCH];
reflection=[centerCH2,leftCH3,leftCH4,rightCH3,rightCH4];
reflectionBinaural=[leftCH3,leftCH4,rightCH3,rightCH4];
reflect={[centerCH1]:centerCH2,[leftCH1]:leftCH3,[rightCH1]:rightCH3,[leftCH2]:leftCH4,[rightCH2]:rightCH4};
reflect2={[centerCH1]:centerCH3,[leftCH1]:leftCH5,[rightCH1]:rightCH5,[leftCH2]:leftCH6,[rightCH2]:rightCH6};
binauralL=[leftCH1,leftCH2,leftCH3,leftCH4,leftCH5,leftCH6];
binauralR=[rightCH1,rightCH2,rightCH3,rightCH4,rightCH5,rightCH6];
flipBinauralF=[centerCH1,centerCH2,centerCH3,leftCH1,rightCH1,leftCH3,rightCH3,leftCH5,rightCH5];
flipBinauralT=[centerCH1,centerCH2,centerCH3,leftCH2,rightCH2,leftCH4,rightCH4,leftCH6,rightCH6];flipBinauralF2=[leftCH1,rightCH1,leftCH3,rightCH3,leftCH5,rightCH5];
flipBinauralT2=[leftCH2,rightCH2,leftCH4,rightCH4,leftCH6,rightCH6];

// midi cc 123 "all notes off" prevents sustain across transitions
allNotesOff=(tick=measureStart)=>{return p(c,...[...source2,...reflection,...bass].map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,123,0]  })));}

grandFinale=()=>{
  c=c.filter(i=>i!==null).map(i=>({...i,tick: isNaN(i.tick) || i.tick<0 ? m.abs(i.tick||0)*rf(.1,.3) : i.tick})).sort((a,b)=>a.tick-b.tick); let finalTick=-Infinity; c.forEach(_=>{ if (!isNaN(_.tick)) { composition+=`1,${_.tick || 0},${_.type || 'note_off_c'},${_.vals.join(',')}\n`; finalTick=m.max(finalTick,_.tick); } else { console.error("NaN tick value encountered:",_); } }); (function finale(){composition+=`1,${finalTick + ticksPerSecond * SILENT_OUTRO_SECONDS},end_track`})(); fs.writeFileSync('output.csv',composition); console.log('output.csv created. Track Length:',finalTime);
};

composition=`0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
fs=require('fs');
