p=pushMultiple=(array,...items)=>{  array.push(...items);  };  
c=csvRows=[];
m=Math;
// Random float(decimal) inclusive of min(s) & max(s). If only one number given, it's the max & min is 0.
rf=randomFloat=(min1, max1, min2, max2)=>{
  if (max1===undefined) { max1=min1; min1=0; }
  [min1, max1]=[m.min(min1, max1),m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2,max2]=[m.min(min2,max2),m.max(min2,max2)];
    const range1=max1-min1; const range2=max2-min2;
    const totalRange=range1+range2; const rand=m.random()*totalRange;
    if (rand < range1) { return m.random()*range1+min1;
    } else { return m.random()*range2+min2; }
  } else { return m.random()*(max1-min1+Number.EPSILON)+min1; }
};
// Random integer(whole number) inclusive of min(s) & max(s). If only one number given, it's the max & min is 0. Although result is rounded, providing decimals in the range allows for more precision.
ri=randomInt=(min1, max1, min2, max2)=>{
  if (max1===undefined) { max1=min1; min1=0; }
  [min1,max1]=[m.min(min1, max1),m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2,max2]=[m.min(min2,max2),m.max(min2,max2)];
    const range1=max1-min1; const range2=max2-min2;
    const totalRange=range1+range2; const rand=m.random()*totalRange;
    if (rand < range1) { 
      return m.min(m.floor(max1),m.max(m.floor(min1),m.round(m.random()*range1+min1)));
    } else {
      return m.min(m.floor(max2),m.max(m.floor(min2),m.round(rand-range1+min2)));
    }
  } else {
    return m.min(m.floor(max1),m.max(m.floor(min1),m.round(m.random()*(max1-min1)+min1)));
  }
};

// Random Limited Increment: random value within range, with limited change per iteration
rl=randomLimitedIncrement=(currentValue,minChange,maxChange,minValue,maxValue,type='i')=>{
  const adjustedMinChange = m.min(minChange, maxChange);
  const adjustedMaxChange = m.max(minChange, maxChange);
  const newMin = m.max(minValue, currentValue + adjustedMinChange);
  const newMax = m.min(maxValue, currentValue + adjustedMaxChange);
  return type === 'f' ? rf(newMin, newMax) : ri(newMin, newMax);
};

// Random variation within range(s) at frequency. Give one range or a separate boost & deboost range.
rv=randomVariation=(value,boostRange=[.05,.10],deboostRange=boostRange,frequency=.05)=>{let factor;
  const singleRange=Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange=singleRange.length===2 && typeof singleRange[0]==='number' && typeof singleRange[1]==='number';
  if (isSingleRange) {  const variation=rf(...singleRange);
    factor=m.random() < frequency ? 1 + variation : 1;
  } else {  const range=m.random() < .5 ? boostRange : deboostRange;
    factor=m.random() < frequency ? 1 + rf(...range) : 1;  }
  return value * factor;
};
// Random weighted selection: any sized list of weights with any values are normalized to fit the inclusive range.
rw=randomWeightedSelection=(min,max,weights)=>{
  const range = max - min + 1;
  let effectiveWeights = weights.map(weight=>weight * (1 + rf(-0.3, 0.3)));
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
  const normalizedWeights = effectiveWeights.map(w => w / totalWeight);
  let random = Math.random();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
}

velocity=99;
secondsPerMeasure=sectionStart=sectionStartTime=ticksPerSection=secondsPerSection=totalTicks=totalTime=finalTick=divsPerBeat=bestMatch=polyMeterRatio=polyNumerator=ticksPerSecond=finalTime=endTime=phraseStart=ticksPerPhrase=phraseStartTime=secondsPerPhrase=measuresPerPhrase1=measuresPerPhrase2=subdivFreq=numerator=meterRatio=divsPerDiv=subdivsPerDiv=measureStart=measureStartTime=flipBinaural=beatsUntilBinauralShift=beatCount=beatsOn=beatsOff=divsOn=divsOff=subdivsOn=subdivsOff=noteCount=beatRhythm=divRhythm=subdivRhythm=balanceOffset=sideBias=firstLoop=side=0;

neutralPitchBend=8192; semitone=neutralPitchBend / 2;
centsToTuningFreq=1200 * m.log2(TUNING_FREQ / 440);
tuningPitchBend=m.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

binauralFreqOffset=rf(BINAURAL.min, BINAURAL.max);
binauralOffset=(plusOrMinus)=>m.round(tuningPitchBend + semitone * (12 * m.log2((TUNING_FREQ + plusOrMinus * binauralFreqOffset) / TUNING_FREQ)));
[binauralPlus, binauralMinus]=[1, -1].map(binauralOffset);

centerCH1=0;centerCH2=1;leftCH1=2;rightCH1=3; leftCH3=4; rightCH3=5; leftCH2=6; rightCH2=7; leftCH4=8; rightCH4=10; //skip ch9=percussion
source=[centerCH1,leftCH1,leftCH2,rightCH1,rightCH2];
reflection=[centerCH2,leftCH3,leftCH4,rightCH3,rightCH4];
reflectionBinaural=[leftCH3,leftCH4,rightCH3,rightCH4];
reflect={[centerCH1]:centerCH2,[leftCH1]:leftCH3,[rightCH1]:rightCH3,[leftCH2]:leftCH4,[rightCH2]:rightCH4};
binauralL=[leftCH1,leftCH2,leftCH3,leftCH4];
binauralR=[rightCH1,rightCH2,rightCH3,rightCH4];
flipBinauralF=[centerCH1,centerCH2,leftCH1,rightCH1,leftCH3,rightCH3];
flipBinauralT=[centerCH1,centerCH2,leftCH2,rightCH2,leftCH4,rightCH4];

//midi cc 123 "all notes off" prevents sustain across transitions
allNotesOff=(tick=measureStart)=>{return p(c, ...[...source,...reflection].map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,123,0]  })));}

grandFinale=()=>{
  c=c.filter(i=>i!==null).map(i=>({...i,tick: isNaN(i.tick) || i.tick<0 ? m.abs(i.tick||0)*rf(.1,.3) : i.tick})).sort((a,b)=>a.tick-b.tick); let finalTick=-Infinity; c.forEach(_=>{ if (!isNaN(_.tick)) { composition+=`1, ${_.tick || 0}, ${_.type || 'note_off_c'}, ${_.vals.join(', ')}\n`; finalTick=Math.max(finalTick,_.tick); } else { console.error("NaN tick value encountered:", _); } }); (function finale(){composition+=`1, ${finalTick + ticksPerSecond * SILENT_OUTRO_SECONDS}, end_track`})(); fs.writeFileSync('output.csv', composition); console.log('output.csv created. Track Length:', finalTime);
};

composition=`0, 0, header, 1, 1, ${PPQ}\n1, 0, start_track\n`;
fs=require('fs');
