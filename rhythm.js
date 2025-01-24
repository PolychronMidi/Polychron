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
onsets=(numbers)=>{ if (typeof numbers==='object' && numbers.hasOwnProperty('make')) {
  numbers=makeOnsets(...numbers.make); }
  return t.RhythmPattern.onsets(numbers);
};
random=(length,probOn)=>{ return t.RhythmPattern.random(length,1 - probOn); };
prob=(probs)=>{ return t.RhythmPattern.probability(probs); };
euclid=(length,ones)=>{ return t.RhythmPattern.euclid(length,ones); };
rotate=(pattern,rotations,direction="R",length=pattern.length)=>{
  if (direction==='?') { direction=m.random() < .5 ? 'L' : 'R'; }
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
  random=(length, probOn)=> { return t.RhythmPattern.random(length, 1 - probOn); };
  switch(level) {
    case 'beat':
      return beatRhythm = beatRhythm < 1 ? t.RhythmPattern.random(numerator, 0) : getRhythm('beat', numerator, beatRhythm);
    case 'div':
      return divRhythm = divRhythm < 1 ? t.RhythmPattern.random(divsPerDiv, 0) : getRhythm('div', divsPerDiv, divRhythm);
    case 'subdiv':
      return subdivRhythm = subdivRhythm < 1 ? t.RhythmPattern.random(subdivsPerDiv, 0) : getRhythm('subdiv', subdivsPerDiv, subdivRhythm)
    default:throw new Error('Invalid level provided to setRhythm');
  }
};

makeOnsets=(length,valuesOrRange)=>{
  let onsets=[];  let total=0;
  while (total < length) {
    let v=randomInSetOrRange(valuesOrRange);
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

patternLength=(pattern, length)=>{
  if (length===undefined) return pattern;
  if (length > pattern.length) {
    while (pattern.length < length) {  pattern=pattern.concat(pattern.slice(0, length - pattern.length));  }
  } else if (length < pattern.length) {  pattern=pattern.slice(0, length);  }
  return pattern;
};

closestDivisor=(x,target=2)=>{
  let closest=Infinity;
  let smallestDiff=Infinity;
  for (let i=1; i <= m.sqrt(x); i++) {
    if (x % i===0) {
      [i, x / i].forEach(divisor=>{
        if (divisor !== closest) { let diff=m.abs(divisor - target);
          if (diff < smallestDiff) {smallestDiff=diff;closest=divisor;}
        }});}}
  if (closest===Infinity) { return x; }
  return x % target===0 ? target : closest;
};

getRhythm = (level, length, pattern, method, ...args) => {
  const levelIndex = ['beat', 'div', 'subdiv'].indexOf(level);
  const checkMethod = (m) => {
    if (!global[m] || typeof global[m] !== 'function') {
      console.warn(`Unknown rhythm method: ${m}`);
      return null;
    }
    return global[m];
  };
  if (method) {
    const rhythmMethod = checkMethod(method);
    if (rhythmMethod) return rhythmMethod(...args);
  } else {
    const filteredRhythms = Object.fromEntries(
      Object.entries(rhythms).filter(([_, { weights }]) => weights[levelIndex] > 0)
    );
    const rhythmKey = selectFromWeightedOptions(filteredRhythms);
    if (rhythmKey && rhythms[rhythmKey]) {
      const { method: rhythmMethodKey, args: rhythmArgs } = rhythms[rhythmKey];
      const rhythmMethod = checkMethod(rhythmMethodKey);
      if (rhythmMethod) return rhythmMethod(...rhythmArgs(length, pattern));
    }
  }
  console.warn('unknown rhythm');
  return null;
};

selectFromWeightedOptions=(options)=>{
  const types = Object.keys(options);
  const weights = types.map(type=>options[type].weights[0]);
  const selectedIndex = rw(0, types.length - 1, weights);
  return types[selectedIndex];
};

randomInSetOrRange=(v)=>{
  if (Array.isArray(v)) {
    return v[0]===v[1] ? v[0] : ri(v[0], v[1]);
  } else if (typeof v==='function') {  const result=v();
    return Array.isArray(result) ? randomInSetOrRange(result) : result; }
  return v;
};

trackBeatRhythm=()=>{beatCount++; if (beatRhythm[beatIndex] > 0) {beatsOn++; beatsOff=0;} else {beatsOn=0; beatsOff++;} };
trackDivRhythm=()=>{if (divRhythm[divIndex] > 0) {divsOn++; divsOff=0;} else {divsOn=0; divsOff++;} };
