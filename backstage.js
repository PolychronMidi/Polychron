p=pushMultiple=(array,...items)=>{  array.push(...items);  };  
c=csvRows=[];
m=Math;

clamp=(value,min,max)=>m.min(m.max(value,min),max);
modClamp=(value,min,max)=>{ // Modulo-based clamp: Value wraps around within range.
  const range=max - min + 1;
  return ((value - min) % range + range) % range + min;
};
lowModClamp=(value,min,max)=>{ // Regular clamp at high end, modClamp at low end.
  if (value >= max) { return max;
  } else if (value < min) { return modClamp(value, min, max);
  } else { return value;
  }
};
highModClamp=(value,min,max)=>{ // Regular clamp at low end, modClamp at high end.
  if (value <= min) { return min;
  } else if (value > max) { return modClamp(value, min, max);
  } else { return value;
  }
};
scaleClamp = (value, min, max, factor, maxFactor = factor, base = value) => {
  const scaledMin = m.max(min * factor, min);
  const scaledMax = m.min(max * maxFactor, max);
  const lowerBound = m.max(min, m.floor(base * factor));
  const upperBound = m.min(max, m.ceil(base * maxFactor));
  return clamp(value, lowerBound, upperBound);
};
scaleBoundClamp=(value,base,lowerScale,upperScale,minBound=2,maxBound=9)=>{
  const lowerBound=m.max(minBound,m.floor(base * lowerScale));
  const upperBound=m.min(maxBound,m.ceil(base * upperScale));
  return clamp(value,lowerBound,upperBound);
};
softClamp = (value, min, max, softness = 0.1) => {
  if (value < min) return min + (value - min) * softness;
  if (value > max) return max - (value - max) * softness;
  return value;
};
stepClamp = (value, min, max, step) => {
  const clampedValue = clamp(m.round(value / step) * step, min, max);
  return clampedValue;
};
logClamp = (value, min, max, base = 10) => {
  const logMin = m.log(min) / m.log(base);
  const logMax = m.log(max) / m.log(base);
  const logValue = m.log(m.max(value, min)) / m.log(base);
  return m.pow(base, m.min(m.max(logValue, logMin), logMax));
};
expClamp = (value, min, max, base = m.E) => {
  const minExp = m.pow(base, min);
  const maxExp = m.pow(base, max);
  const valueExp = m.pow(base, value);
  return m.log(m.min(m.max(valueExp, minExp), maxExp)) / m.log(base);
};

// Random Float (decimal) inclusive of min(s) & max(s). If only 1 number given, max=number & min=0.
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

// Random Integer (whole number) inclusive of min(s) & max(s). If only 1 number given, max=number & min=0. Although result is rounded, decimals (if provided) are still calculated in range.
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

// Random limited Change: Random value from inclusive range, with limited change per iteration.
rl=randomLimitedChange=(currentValue,minChange,maxChange,minValue,maxValue,type='i')=>{
  const adjustedMinChange=m.min(minChange,maxChange);
  const adjustedMaxChange=m.max(minChange,maxChange);
  const newMin=m.max(minValue,currentValue+adjustedMinChange);
  const newMax=m.min(maxValue,currentValue+adjustedMaxChange);
  return type==='f' ? rf(newMin,newMax) : ri(newMin,newMax);
};

// Random Limited Change of FX values: Uses rl & nested structure in Map to store & increment effect values for each channel & effect type.
rlFX=(ch,effectNum,minValue,maxValue,condition=null,conditionMin=null,conditionMax=null)=>{
  chFX=new Map();
  if (!chFX.has(ch)) { chFX.set(ch,{}); }
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
  return {..._,vals:[ch,effectNum,midiEffect.getValue()]};
};

// Random variation within range(s) at frequency: Give 1 range or separate boost/deboost ranges.
rv=randomVariation=(value,boostRange=[.05,.10],deboostRange=boostRange,frequency=.05)=>{let factor;
  const singleRange=Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange=singleRange.length===2 && typeof singleRange[0]==='number' && typeof singleRange[1]==='number';
  if (isSingleRange) {  const variation=rf(...singleRange);
    factor=rf() < frequency ? 1 + variation : 1;
  } else {  const range=rf() < .5 ? boostRange : deboostRange;
    factor=rf() < frequency ? 1 + rf(...range) : 1;  }
  return value * factor;
};

// Normalize Weights: Any sized list of weights with any values are normalized to fit inclusive range.
normalizeWeights = (weights, min, max, variationLow=.7, variationHigh=1.3) => {
  const range = max - min + 1;
  let effectiveWeights = weights.map(weight => weight * rf(variationLow, variationHigh));
  if (effectiveWeights.length !== range) {
    if (effectiveWeights.length < range) {
      const newWeights = [];
      for (let i = 0; i < range; i++) {
        const fraction = i / (range - 1);
        const lowerIndex = Math.floor(fraction * (effectiveWeights.length - 1));
        const upperIndex = Math.min(lowerIndex + 1, effectiveWeights.length - 1);
        const weightDiff = effectiveWeights[upperIndex] - effectiveWeights[lowerIndex];
        const interpolatedWeight = effectiveWeights[lowerIndex] + (fraction * (effectiveWeights.length - 1) - lowerIndex) * weightDiff;
        newWeights.push(interpolatedWeight);
      }
      effectiveWeights = newWeights;
    } else {
      const groupSize = Math.floor(effectiveWeights.length / range);
      effectiveWeights = Array(range).fill(0).map((_, i) => {
        const startIndex = i * groupSize;
        const endIndex = Math.min(startIndex + groupSize, effectiveWeights.length);
        return effectiveWeights.slice(startIndex, endIndex).reduce((sum, w) => sum + w, 0) / (endIndex - startIndex);
      });
    }
  }
  const totalWeight = effectiveWeights.reduce((acc, w) => acc + w, 0);
  return effectiveWeights.map(w => w / totalWeight);
};

rw = randomWeightedInRange = (min, max, weights) => {
  const normalizedWeights = normalizeWeights(weights, min, max);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
};

randomWeightedInArray = (weights) => {
  const normalizedWeights = normalizeWeights(weights, 0, weights.length - 1);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i;
  }
  return weights.length - 1;
};

randomWeightedSelection = (options) => {
  const types = Object.keys(options);
  const weights = types.map(type => options[type].weights[0]);
  const normalizedWeights = normalizeWeights(weights, 0, types.length - 1);
  const selectedIndex = rw(0, types.length - 1, normalizedWeights);
  return types[selectedIndex];
};

randomInRangeOrArray=(v)=>{
  if (Array.isArray(v)) {
    return v[0]===v[1] ? v[0] : ri(v[0],v[1]);
  } else if (typeof v==='function') {  const result=v();
    return Array.isArray(result) ? randomInRangeOrArray(result) : result; }
  return v;
};

velocity=99; flipBinaural=false;
measureCount=secondsPerMeasure=subdivStart=beatStart=divStart=sectionStart=sectionStartTime=ticksPerSection=secondsPerSection=finalTick=divsPerBeat=bestMatch=polyMeterRatio=polyNumerator=ticksPerSecond=finalTime=endTime=phraseStart=ticksPerPhrase=phraseStartTime=secondsPerPhrase=measuresPerPhrase1=measuresPerPhrase2=subdivsPerMinute=numerator=meterRatio=divsPerDiv=subdivsPerDiv=measureStart=measureStartTime=beatsUntilBinauralShift=beatCount=beatsOn=beatsOff=divsOn=divsOff=subdivsOn=subdivsOff=noteCount=beatRhythm=divRhythm=subdivRhythm=balanceOffset=sideBias=firstLoop=0;

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
flipBinauralF3=[centerCH2,centerCH3,leftCH1,rightCH1,leftCH3,rightCH3,leftCH5,rightCH5];
flipBinauralT3=[centerCH2,centerCH3,leftCH2,rightCH2,leftCH4,rightCH4,leftCH6,rightCH6];
stutterFadeCHs=[centerCH2,centerCH3,leftCH1,rightCH1,leftCH2,rightCH2,leftCH3,rightCH3,leftCH4,rightCH4,leftCH5,rightCH5,leftCH6,rightCH6];
allCHs=[centerCH1,centerCH2,centerCH3,leftCH1,rightCH1,leftCH2,rightCH2,leftCH3,rightCH3,leftCH4,rightCH4,leftCH5,rightCH5,leftCH6,rightCH6,drumCH];
stutterPanCHs=[centerCH1,centerCH2,centerCH3,drumCH];

// midi cc 123 "all notes off" prevents sustain across transitions
allNotesOff=(tick=measureStart)=>{return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,123,0]  })));}
muteAll=(tick=measureStart)=>{return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,120,0]  })));}

grandFinale=()=>{ allNotesOff(sectionStart+PPQ);muteAll(sectionStart+PPQ*2);
  c=c.filter(i=>i!==null).map(i=>({...i,tick: isNaN(i.tick) || i.tick<0 ? m.abs(i.tick||0)*rf(.1,.3) : i.tick})).sort((a,b)=>a.tick-b.tick); let finalTick=-Infinity; c.forEach(_=>{ if (!isNaN(_.tick)) { composition+=`1,${_.tick || 0},${_.type || 'note_off_c'},${_.vals.join(',')}\n`; finalTick=m.max(finalTick,_.tick); } else { console.error("NaN tick value encountered:",_); } }); (function finale(){composition+=`1,${finalTick + ticksPerSecond * SILENT_OUTRO_SECONDS},end_track`})(); fs.writeFileSync('output.csv',composition); console.log('output.csv created. Track Length:',finalTime);
};

composition=`0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
fs=require('fs');
