drumMap={
  'snare1': {note: 31,velocityRange: [99,111]},
  'snare2': {note: 33,velocityRange: [99,111]},
  'snare3': {note: 124,velocityRange: [77,88]},
  'snare4': {note: 125,velocityRange: [77,88]},
  'snare5': {note: 75,velocityRange: [77,88]},
  'snare6': {note: 85,velocityRange: [77,88]},
  'snare7': {note: 118,velocityRange: [66,77]},
  'snare8': {note: 41,velocityRange: [66,77]},

  'kick1': {note: 12,velocityRange: [111,127]},
  'kick2': {note: 14,velocityRange: [111,127]},
  'kick3': {note: 0,velocityRange: [99,111]},
  'kick4': {note: 2,velocityRange: [99,111]},
  'kick5': {note: 4,velocityRange: [88,99]},
  'kick6': {note: 5,velocityRange: [88,99]},
  'kick7': {note: 6,velocityRange: [88,99]},

  'cymbal1': {note: 59,velocityRange: [66,77]},
  'cymbal2': {note: 53,velocityRange: [66,77]},
  'cymbal3': {note: 80,velocityRange: [66,77]},
  'cymbal4': {note: 81,velocityRange: [66,77]},

  'conga1': {note: 60,velocityRange: [66,77]},
  'conga2': {note: 61,velocityRange: [66,77]},
  'conga3': {note: 62,velocityRange: [66,77]},
  'conga4': {note: 63,velocityRange: [66,77]},
  'conga5': {note: 64,velocityRange: [66,77]},
};
drummer=(drumNames,beatOffsets,offsetJitter=rf(.1),stutterChance=.3,stutterRange=[2,m.round(rv(11,[2,3],.3))],stutterDecayFactor=rf(.9,1.1))=>{
  if (drumNames==='random') {
    const allDrums=Object.keys(drumMap);
    drumNames=[allDrums[m.floor(m.random() * allDrums.length)]];
    beatOffsets=[0];
  }
  const drums=Array.isArray(drumNames) ? drumNames : drumNames.split(',').map(d=>d.trim());
  const offsets=Array.isArray(beatOffsets) ? beatOffsets : [beatOffsets];
  if (offsets.length < drums.length) { // Adjust offsets if needed
    offsets.push(...new Array(drums.length - offsets.length).fill(0));
  } else if (offsets.length > drums.length) {
    offsets.length=drums.length;
  }
  const combined=drums.map((drum,index)=>({ drum,offset: offsets[index] }));
  if (rf() < .7) { // Reverse or randomize the order of drums and offsets
    if (rf() < .5) {
      combined.reverse();
    }
  } else {
    for (let i=combined.length - 1; i > 0; i--) {
      const j=m.floor(m.random() * (i + 1));
      [combined[i],combined[j]]=[combined[j],combined[i]];
    }
  }
  const adjustedOffsets=combined.map(({ offset })=>{ // Adjust offsets with jitter
    if (rf() < .3) {
      return offset;
    } else {
      let adjusted=offset + (m.random() < 0.5 ? -offsetJitter*rf(.5,1) : offsetJitter*rf(.5,1));
      return adjusted - m.floor(adjusted);
    }
  });
  combined.forEach(({ drum,offset })=>{ // Apply stutter
    const drumInfo=drumMap[drum];
    if (drumInfo) {
      if (rf() < stutterChance) {
        const numStutters=ri(...stutterRange);
        const stutterDuration=.25* ri(1,8) / numStutters;
        const [minVelocity,maxVelocity]=drumInfo.velocityRange;
        const isFadeIn=rf() < 0.7;
        for (let i=0; i < numStutters; i++) {
          const currentTick=beatStart + (offset + i * stutterDuration) * ticksPerBeat;
          let currentVelocity;
          if (isFadeIn) {
            const fadeInMultiplier=stutterDecayFactor * (i / (numStutters*rf(0.4,2.2) - 1));
            currentVelocity=clamp(m.min(maxVelocity,ri(33) + maxVelocity * fadeInMultiplier),0,127);
          } else {
            const fadeOutMultiplier=1 - (stutterDecayFactor * (i / (numStutters*rf(0.4,2.2) - 1)));
            currentVelocity=clamp(m.max(0,ri(33) + maxVelocity * fadeOutMultiplier),0,127);
          }
          p(c,{tick: currentTick,type: 'note_on_c',vals: [drumCH,drumInfo.note,m.floor(currentVelocity)]});
        }
      } else { // Play without stutter
        p(c,{tick: beatStart + offset * ticksPerBeat,type: 'note_on_c',vals: [drumCH,drumInfo.note,ri(...drumInfo.velocityRange)]});
      }
    }
  });
};
playDrums=()=>{
  if (beatIndex % 2===0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['kick1','kick3'],[0,.5]);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['kick2','kick5'],[0,.5]);
    }
  } else if (beatRhythm[beatIndex] > 0  && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['snare1','kick4','kick7','snare4'],[0,.5,.75,.25]);
  } else if (beatIndex % 2===0) {
    drummer('random');
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['snare5'],[0]);
    }
  } else  {
    drummer(['snare6'],[0]);
  }
};
playDrums2=()=>{
  if (beatIndex % 2===0 && beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['kick2','kick5','kick7'],[0,.5,.25]);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['kick1','kick3','kick7'],[0,.5,.25]);
    }
  } else if (beatRhythm[beatIndex] > 0 && rf() < .3 * m.max(1,beatsOff*rf(2,3.5))*bpmRatio3) {
    drummer(['snare2','kick6','snare3'],[0,.5,.75]);
  } else if (beatIndex % 2===0) {
    drummer(['snare7'],[0]);
    if (numerator % 2===1 && beatIndex===numerator - 1 && rf() < (1/measuresPerPhrase)*bpmRatio3) {
      drummer(['snare7'],[0]);
    }
  } else  {
    drummer('random');
  }
};

rhythms={//weights: [beat,div,subdiv]
  'binary':{weights:[2,3,1],method:'binary',args:(length)=>[length]},
  'hex':{weights:[2,3,1],method:'hex',args:(length)=>[length]},
  'onsets':{weights:[5,0,0],method:'onsets',args:(length)=>[{make:[length,()=>[1,2]]}]},
  'onsets2':{weights:[0,2,0],method:'onsets',args:(length)=>[{make:[length,[2,3,4]]}]},
  'onsets3':{weights:[0,0,7],method:'onsets',args:(length)=>[{make:[length,()=>[3,7]]}]},
  'random':{weights:[7,0,0],method:'random',args:(length)=>[length,rv(.97,[-.1,.3],.2)]},
  'random2':{weights:[0,3,0],method:'random',args:(length)=>[length,rv(.9,[-.3,.3],.3)]},
  'random3':{weights:[0,0,1],method:'random',args:(length)=>[length,rv(.6,[-.3,.3],.3)]},
  'euclid':{weights:[3,3,3],method:'euclid',args:(length)=>[length,closestDivisor(length,m.ceil(rf(2,length / rf(1,1.2))))]},
  'rotate':{weights:[2,2,2],method:'rotate',args:(length,pattern)=>[pattern,ri(2),'?',length]},
  'morph':{weights:[2,3,3],method:'morph',args:(length,pattern)=>[pattern,'?',length]}
};

binary=(length)=>{ let pattern=[];
  while (pattern.length < length) { pattern=pattern.concat(t.RhythmPattern.binary(ri(99))); }
  return patternLength(pattern,length);
};
hex=(length)=>{ let pattern=[];
  while (pattern.length < length) { pattern=pattern.concat(t.RhythmPattern.hex(ri(99).toString(16))); }
  return patternLength(pattern,length);
};
onsets = (numbers) => {
if (typeof numbers === 'object' && numbers.hasOwnProperty('make')) {
    return makeOnsets(...numbers.make);
  }
  return t.RhythmPattern.onsets(numbers);
};
random=(length,probOn)=>{ return t.RhythmPattern.random(length,1 - probOn); };
prob=(probs)=>{ return t.RhythmPattern.probability(probs); };
euclid=(length,ones)=>{ return t.RhythmPattern.euclid(length,ones); };
rotate=(pattern,rotations,direction="R",length=pattern.length)=>{
  if (direction==='?') { direction=rf() < .5 ? 'L' : 'R'; }
  if (direction.toUpperCase()==='L') { rotations=(pattern.length - rotations) % pattern.length; }
  return patternLength(t.RhythmPattern.rotate(pattern,rotations),length);
};
morph=(pattern,direction='both',length=pattern.length,probLow=.1,probHigh)=>{
  probHigh=probHigh===undefined ? probLow : probHigh;
  let morpheus=pattern.map((v,index)=>{
    let morph=probHigh===probLow ? rf(probLow) : rf(probLow,probHigh);
    let _=['up','down','both']; let d=direction==='?' ? (_[ri(_.length - 1)]) : direction.toLowerCase();
    let up=v < 1 ? m.min(v + morph,1) : v;  let down=v > 0 ? m.max(v - morph,0) : v;
    return (d==='up' ? up : d==='down' ? down : d==='both' ? (v < 1 ? up : down) : v);
  });
  return prob(patternLength(morpheus,length));
};

setRhythm=(level)=>{
  random=(length,probOn)=> { return t.RhythmPattern.random(length,1 - probOn); };
  switch(level) {
    case 'beat':
      return beatRhythm=beatRhythm < 1 ? t.RhythmPattern.random(numerator) : getRhythm('beat',numerator,beatRhythm);
    case 'div':
      return divRhythm=divRhythm < 1 ? t.RhythmPattern.random(divsPerDiv,.4) : getRhythm('div',divsPerDiv,divRhythm);
    case 'subdiv':
      return subdivRhythm=subdivRhythm < 1 ? t.RhythmPattern.random(subdivsPerDiv,.3) : getRhythm('subdiv',subdivsPerDiv,subdivRhythm)
    default:throw new Error('Invalid level provided to setRhythm');
  }
};

makeOnsets=(length,valuesOrRange)=>{
  let onsets=[];  let total=0;
  while (total < length) {
    let v=randomInRangeOrArray(valuesOrRange);
    if (total + (v+1) <= length) {  onsets.push(v);  total+=v+1;
    } else if (Array.isArray(valuesOrRange) && valuesOrRange.length===2) {
      v=valuesOrRange[0];
      if (total + (v+1) <= length) { onsets.push(v);  total+=v+1; }
      break;
    } else {  break;
  } }
  let rhythm=[];
  for (let onset of onsets) {  rhythm.push(1);
    for (let i=0; i < onset; i++) { rhythm.push(0); }
  }
  while (rhythm.length < length) { rhythm.push(0); }
  return rhythm;
};

patternLength=(pattern,length)=>{
  if (length===undefined) return pattern;
  if (length > pattern.length) {
    while (pattern.length < length) {  pattern=pattern.concat(pattern.slice(0,length - pattern.length));  }
  } else if (length < pattern.length) {  pattern=pattern.slice(0,length);  }
  return pattern;
};

closestDivisor=(x,target=2)=>{
  let closest=Infinity;
  let smallestDiff=Infinity;
  for (let i=1; i <= m.sqrt(x); i++) {
    if (x % i===0) {
      [i,x / i].forEach(divisor=>{
        if (divisor !== closest) { let diff=m.abs(divisor - target);
          if (diff < smallestDiff) {smallestDiff=diff;closest=divisor;}
        }});}}
  if (closest===Infinity) { return x; }
  return x % target===0 ? target : closest;
};

getRhythm=(level,length,pattern,method,...args)=>{
  const levelIndex=['beat','div','subdiv'].indexOf(level);
  const checkMethod=(m)=>{
    if (!global[m] || typeof global[m] !== 'function') {
      console.warn(`Unknown rhythm method: ${m}`);
      return null;
    }
    return global[m];
  };
  if (method) {
    const rhythmMethod=checkMethod(method);
    if (rhythmMethod) return rhythmMethod(...args);
  } else {
    const filteredRhythms=Object.fromEntries(
      Object.entries(rhythms).filter(([_,{ weights }])=>weights[levelIndex] > 0)
    );
    const rhythmKey=randomWeightedSelection(filteredRhythms);
    if (rhythmKey && rhythms[rhythmKey]) {
      const { method: rhythmMethodKey,args: rhythmArgs }=rhythms[rhythmKey];
      const rhythmMethod=checkMethod(rhythmMethodKey);
      if (rhythmMethod) return rhythmMethod(...rhythmArgs(length,pattern));
    }
  }
  console.warn('unknown rhythm');
  return null;
};

trackBeatRhythm=()=>{if (beatRhythm[beatIndex] > 0) {beatsOn++; beatsOff=0;} else {beatsOn=0; beatsOff++;} };
trackDivRhythm=()=>{if (divRhythm[divIndex] > 0) {divsOn++; divsOff=0;} else {divsOn=0; divsOff++;} };
