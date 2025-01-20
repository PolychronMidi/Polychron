m = Math;
randomFloat = rf = (min1, max1, min2, max2) => {
  if (max1===undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const totalRange = range1 + range2;
    const rand = m.random() * totalRange;
    if (rand < range1) {
      return m.random() * range1 + min1;
    } else {
      return m.random() * range2 + min2;
    }
  } else {
    return m.random() * (max1 - min1 + Number.EPSILON) + min1;
  }
};

randomInt = ri = (min1, max1, min2, max2) => {
  if (max1===undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const totalRange = range1 + range2;
    const rand = m.random() * totalRange;
    if (rand < range1) {
      return m.max(min1, m.min(m.round(rand + min1, max1)));
    } else {
      return m.max(min2, m.min(m.round(rand - range1 + min2, max2)));
    }
  } else {
    return m.max(min1, m.min(m.round(m.random() * (max1 - min1) + min1, max1)));
  }
};
// Random variation within range(s) at frequency. Give one range or a separate boost and deboost range.
randomVariation=rv=(value,boostRange=[.05,.10],deboostRange=boostRange,frequency=.05)=>{let factor;
  const singleRange=Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange=singleRange.length===2 && typeof singleRange[0]==='number' && typeof singleRange[1]==='number';
  if (isSingleRange) {  const variation=rf(...singleRange);
    factor=m.random() < frequency ? 1 + variation : 1;
  } else {  const range=m.random() < .5 ? boostRange : deboostRange;
    factor=m.random() < frequency ? 1 + rf(...range) : 1;  }
  return value * factor;
};
randomInSetOrRange=(v)=>{
  if (Array.isArray(v)) {
    return v[0]===v[1] ? v[0] : ri(v[0], v[1]);
  } else if (typeof v==='function') {  const result=v();
    return Array.isArray(result) ? randomInSetOrRange(result) : result; }
  return v;
};
// Random weighted selection. Any sized list of weights with any values are normalized to fit the range.
rw=randomWeightedSelection=(min,max,weights)=>{
  const range = max - min + 1;
  let effectiveWeights = weights;
  effectiveWeights = weights.map(weight => {
    const randomFactor = rf(-0.3, 0.3);
    return weight * (1 + randomFactor);
  });
  if (effectiveWeights.length !== range) {
    const firstWeight = effectiveWeights[0];
    const lastWeight = effectiveWeights[effectiveWeights.length - 1];
    if (effectiveWeights.length < range) {
      const newWeights = [firstWeight];
      for (let i = 1; i < range - 1; i++) {
        const fraction = i / (range - 1);
        const lowerIndex = m.floor(fraction * (effectiveWeights.length - 1));
        const upperIndex = m.ceil(fraction * (effectiveWeights.length - 1));
        const weightDiff = effectiveWeights[upperIndex] - effectiveWeights[lowerIndex];
        const interpolatedWeight = effectiveWeights[lowerIndex] + (fraction * (effectiveWeights.length - 1) - lowerIndex) * weightDiff;
        newWeights.push(interpolatedWeight);
      }
      newWeights.push(lastWeight);
      effectiveWeights = newWeights;
    } else if (effectiveWeights.length > range) {
      effectiveWeights = [firstWeight];
      const groupSize = m.floor(effectiveWeights.length / (range - 1));
      for (let i = 1; i < range - 1; i++) {
        const startIndex = i * groupSize;
        const endIndex = m.min(startIndex + groupSize, effectiveWeights.length - 1);
        const groupSum=effectiveWeights.slice(startIndex,endIndex).reduce((sum,w)=>sum+w,0);
        effectiveWeights.push(groupSum / (endIndex - startIndex));
      }
      effectiveWeights.push(lastWeight);
    }
  }
  const totalWeight = effectiveWeights.reduce((acc, w)=>acc + w, 0);
  const normalizedWeights = effectiveWeights.map(w=>w / totalWeight);
  let random = m.random();
  let cumulativeProbability = 0;
  for (let i = 0; i < normalizedWeights.length; i++) {
    cumulativeProbability += normalizedWeights[i];
    if (random <= cumulativeProbability) { return i + min; }
  }
}

selectFromWeightedOptions=(options)=>{
  const types = Object.keys(options);
  const weights = types.map(type => options[type].weights[0]);
  const selectedIndex = rw(0, types.length - 1, weights);
  return types[selectedIndex];
};

closestDivisor=(x,target=2)=>{
  let closest=Infinity;
  let smallestDiff=Infinity;
  for (let i=1; i <= m.sqrt(x); i++) {
    if (x % i===0) {
      [i, x / i].forEach(divisor=>{
        if (divisor !== closest) {
          let diff=m.abs(divisor - target);
          if (diff < smallestDiff) {
            smallestDiff=diff;
            closest=divisor;
          }
        }
      });
    }
  }
  if (closest===Infinity) {
    return x;
  }
  return x % target===0 ? target : closest;
};

makeOnsets=(length,valuesOrRange)=>{
  let onsets=[];  let total=0;
  // Build onsets until reach or exceed length or run out of values to use
  while (total < length) {
    let v=randomInSetOrRange(valuesOrRange);
    if (total + (v+1) <= length) { // +1 because each onset adds 1 to length
      onsets.push(v);  total+=v+1;
    } else if (Array.isArray(valuesOrRange) && valuesOrRange.length===2) {
      // Try one more time with the low end of the range
      v=valuesOrRange[0];
      if (total + (v+1) <= length) { onsets.push(v);  total+=v+1; }
      break; // Stop after trying with the lower end or if it doesn't fit
    } else {
      break; // If not a range or if the range doesn't fit even with the lower value
    }
  }
  // Convert onsets to rhythm pattern
  let rhythm=[];
  for (let onset of onsets) {
    rhythm.push(1);
    for (let i=0; i < onset; i++) { rhythm.push(0); }
  }
  // If length less than desired length, pad with zeros
  while (rhythm.length < length) { rhythm.push(0); }
  return rhythm;
};

patternLength=(pattern, length)=>{
  if (length===undefined) return pattern;
  if (length > pattern.length) {
    while (pattern.length < length) {  pattern=pattern.concat(pattern.slice(0, length - pattern.length));  }
  } else if (length < pattern.length) {  pattern=pattern.slice(0, length);  }
  return pattern;
};

formatTime=(seconds)=>{ 
  const minutes=m.floor(seconds / 60); seconds=(seconds % 60).toFixed(4).padStart(7, '0');
  return `${minutes}:${seconds}`;
};

setTiming=()=>{  p(c,  { tick:measureStartTick, type:'bpm', vals:[midiBPM] },
  { tick:measureStartTick, type:'meter', vals:[midiMeter[0], midiMeter[1]] });  };

numerator=meterRatio=divsPerDiv=subdivsPerDiv=measureStartTick=measureStartTime=flipBinaural=beatsUntilBinauralShift=beatCount=beatsOn=beatsOff=divsOn=divsOff=subdivsOn=subdivsOff=noteCount=beatRhythm=divRhythm=subdivRhythm=balanceOffset=sideBias=firstLoop=side=0;

neutralPitchBend=8192; semitone=neutralPitchBend / 2;
centsToTuningFreq=1200 * m.log2(TUNING_FREQ / 440);
tuningPitchBend=m.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

binauralFreqOffset=rf(BINAURAL.min, BINAURAL.max);
binauralOffset=(plusOrMinus)=>m.round(tuningPitchBend + semitone * (12 * m.log2((TUNING_FREQ + plusOrMinus * binauralFreqOffset) / TUNING_FREQ)));
[binauralPlus, binauralMinus]=[1, -1].map(binauralOffset);

centerCH1=0;centerCH2=1;leftCH1=2;rightCH1=3; leftCH3=4; rightCH3=5; leftCH2=6; rightCH2=7; leftCH4=8; rightCH4=10; //skip ch9=percussion
source=[centerCH1, leftCH1, leftCH2, rightCH1, rightCH2];
reflection=[centerCH2, leftCH3, leftCH4, rightCH3, rightCH4];
reflectionBinaural=[leftCH3, leftCH4, rightCH3, rightCH4];
reflect={[centerCH1]:centerCH2,[leftCH1]:leftCH3,[rightCH1]:rightCH3,[leftCH2]:leftCH4,[rightCH2]:rightCH4};
binauralL=[leftCH1, leftCH2, leftCH3, leftCH4];
binauralR=[rightCH1, rightCH2, rightCH3, rightCH4];
flipBinauralF = [centerCH1, centerCH2, leftCH1, rightCH1, leftCH3, rightCH3];
flipBinauralT = [centerCH1, centerCH2, leftCH2, rightCH2, leftCH4, rightCH4];

//midi cc 123 "all notes off" prevents sustain across transitions
allNotesOff=(tick=measureStartTick)=>{return p(c, ...[...source, ...reflection].map(ch=>({tick:m.max(0,tick-1), type:'control_c', vals:[ch, 123, 0]  })));}

incrementMeasure=()=>{
  logUnit('measure');
  allNotesOff();
  measureStartTick+=ticksPerMeasure;  measureStartTime+=secondsPerMeasure;
}

grandFinale=()=>{
  c=c.filter(i=>i!==null).map(i=>({...i,tick:i.tick<0?Math.abs(i.tick)*rf(.1,.3):i.tick})).sort((a,b)=>a.tick-b.tick); c.forEach(_=>{ composition+=`1, ${_.tick || 0}, ${_.type || 'note_off_c'}, ${_.vals.join(', ')}\n`; finalTick=_.tick; }); composition+=finale(); fs.writeFileSync('output.csv', composition); console.log('output.csv created. Track Length:', finalTime);
};

subdivFreq=300;
velocity=99;
composition=`0, 0, header, 1, 1, ${PPQ}\n1, 0, start_track\n`;
finale=()=>`1, ${finalTick + ticksPerSecond * SILENT_OUTRO_SECONDS}, end_track`;
fs=require('fs');
