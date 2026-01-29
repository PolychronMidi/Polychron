// backstage.js - Core utilities, randomization, and MIDI infrastructure.
// minimalist comments, details at: backstage.md

const { writeDebugFile } = require('./logGate');

m=Math;
/**
 * Clamp a value within [min, max] range.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @returns {number} Clamped value.
 */
clamp=(value,min,max)=>{if(min>max)[min,max]=[max,min];return m.min(m.max(value,min),max);};

/**
 * Modulo-based clamp: Value wraps around within range.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @returns {number} Wrapped value within range.
 */
modClamp=(value,min,max)=>{
  // Validate inputs to prevent edge cases
  if (min > max) {
    // Swap min and max if they're reversed
    [min, max] = [max, min];
  }
  const range=max - min + 1;
  // Handle edge case where range is 0 or negative
  if (range <= 0) {
    return min; // Return min as fallback
  }
  return ((value - min) % range + range) % range + min;
};

/**
 * Regular clamp at high end, modClamp at low end.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @returns {number} Clamped value.
 */
lowModClamp=(value,min,max)=>{
  if (value >= max) { return max;
  } else if (value < min) { return modClamp(value, min, max);
  } else { return value;
  }
};

/**
 * Regular clamp at low end, modClamp at high end.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @returns {number} Clamped value.
 */
highModClamp=(value,min,max)=>{
  if (value <= min) { return min;
  } else if (value > max) { return modClamp(value, min, max);
  } else { return value;
  }
};

/**
 * Scale-based clamp with dynamic bounds.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum bound.
 * @param {number} max - Maximum bound.
 * @param {number} factor - Lower bound scale factor.
 * @param {number} [maxFactor=factor] - Upper bound scale factor.
 * @param {number} [base=value] - Base value for bound calculation.
 * @returns {number} Clamped value.
 */
scaleClamp = (value, min, max, factor, maxFactor = factor, base = value) => {
  const scaledMin = m.max(min * factor, min);
  const scaledMax = m.min(max * maxFactor, max);
  const lowerBound = m.max(min, m.floor(base * factor));
  const upperBound = m.min(max, m.ceil(base * maxFactor));
  return clamp(value, lowerBound, upperBound);
};

/**
 * Scale-based clamp with explicit bounds.
 * @param {number} value - Value to clamp.
 * @param {number} base - Base value for bound calculation.
 * @param {number} lowerScale - Lower bound scale multiplier.
 * @param {number} upperScale - Upper bound scale multiplier.
 * @param {number} [minBound=2] - Minimum bound cap.
 * @param {number} [maxBound=9] - Maximum bound cap.
 * @returns {number} Clamped value.
 */
scaleBoundClamp=(value,base,lowerScale,upperScale,minBound=2,maxBound=9)=>{
  let lowerBound=m.max(minBound,m.floor(base * lowerScale));
  let upperBound=m.min(maxBound,m.ceil(base * upperScale));
  // Ensure lowerBound doesn't exceed upperBound, prioritizing maxBound
  if(lowerBound>upperBound) lowerBound=upperBound;
  return clamp(value,lowerBound,upperBound);
};

/**
 * Soft clamp with gradual boundary approach.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @param {number} [softness=0.1] - Softness factor (0-1).
 * @returns {number} Softly clamped value.
 */
softClamp = (value, min, max, softness = 0.1) => {
  if (value < min) return min + (value - min) * softness;
  if (value > max) return max - (value - max) * softness;
  return value;
};

/**
 * Step-based clamp: Snaps value to nearest step.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @param {number} step - Step size for snapping.
 * @returns {number} Step-clamped value.
 */
stepClamp = (value, min, max, step) => {
  const clampedValue = clamp(m.round(value / step) * step, min, max);
  return clampedValue;
};

/**
 * Logarithmic clamp for exponential value ranges.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @param {number} [base=10] - Logarithm base.
 * @returns {number} Logarithmically clamped value.
 */
logClamp = (value, min, max, base = 10) => {
  const logMin = m.log(min) / m.log(base);
  const logMax = m.log(max) / m.log(base);
  const logValue = m.log(m.max(value, min)) / m.log(base);
  return m.pow(base, m.min(m.max(logValue, logMin), logMax));
};

/**
 * Exponential clamp for logarithmic value ranges.
 * @param {number} value - Value to clamp.
 * @param {number} min - Minimum allowed value (log domain).
 * @param {number} max - Maximum allowed value (log domain).
 * @param {number} [base=Math.E] - Exponential base.
 * @returns {number} Exponentially clamped value.
 */
expClamp = (value, min, max, base = m.E) => {
  const minExp = m.pow(base, min);
  const maxExp = m.pow(base, max);
  const valueExp = m.pow(base, value);
  return m.log(m.min(m.max(valueExp, minExp), maxExp)) / m.log(base);
};

/**
 * Random Float (decimal) inclusive of min(s) & max(s).
 * @param {number} [min1=1] - First minimum value (or max if only one arg).
 * @param {number} [max1] - First maximum value.
 * @param {number} [min2] - Second minimum for dual range.
 * @param {number} [max2] - Second maximum for dual range.
 * @returns {number} Random float in range(s).
 * @example
 * // Random between 0 and 10
 * rf(10)
 * @example
 * // Random between 5 and 15
 * rf(5, 15)
 * @example
 * // Random between 0-10 or 20-30
 * rf(10, 20, 30)
 */
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

/**
 * Random Integer (whole number) inclusive of min(s) & max(s).
 * @param {number} [min1=1] - First minimum value (or max if only one arg).
 * @param {number} [max1] - First maximum value.
 * @param {number} [min2] - Second minimum for dual range.
 * @param {number} [max2] - Second maximum for dual range.
 * @returns {number} Random integer in range(s).
 * @example
 * // Random integer 0-10
 * ri(10)
 * @example
 * // Random integer 5-15
 * ri(5, 15)
 */
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

/**
 * Random Limited Change: Random value from inclusive range, with limited change per iteration.
 * @param {number} currentValue - Current value.
 * @param {number} minChange - Minimum change amount.
 * @param {number} maxChange - Maximum change amount.
 * @param {number} minValue - Minimum allowed value.
 * @param {number} maxValue - Maximum allowed value.
 * @param {string} [type='i'] - 'i' for integer, 'f' for float.
 * @returns {number} New value with limited change.
 */
rl=randomLimitedChange=(currentValue,minChange,maxChange,minValue,maxValue,type='i')=>{
  const adjustedMinChange=m.min(minChange,maxChange);
  const adjustedMaxChange=m.max(minChange,maxChange);
  const newMin=m.max(minValue,currentValue+adjustedMinChange);
  const newMax=m.min(maxValue,currentValue+adjustedMaxChange);
  return type==='f' ? rf(newMin,newMax) : ri(newMin,newMax);
};

/**
 * Random Limited Change of FX values.
 * @param {number} ch - MIDI channel.
 * @param {number} effectNum - Effect number.
 * @param {number} minValue - Minimum effect value.
 * @param {number} maxValue - Maximum effect value.
 * @param {function} [condition=null] - Condition function for channel.
 * @param {number} [conditionMin] - Min value when condition met.
 * @param {number} [conditionMax] - Max value when condition met.
 * @returns {Object} FX object with channel, effect number, and value.
 */
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
      let change=(newMax-newMin)*rf(.1,.3);
      if (condition !== null && typeof condition==='function' && condition(ch)) {
        newMin=conditionMin;
        newMax=conditionMax;
        effectValue=clamp(rl(effectValue,m.floor(-change),m.ceil(change),newMin,newMax),newMin,newMax);
      } else {
        effectValue=clamp(rl(effectValue,m.floor(-change),m.ceil(change),newMin,newMax),newMin,newMax);
      }
      chFXMap[effectNum]=effectValue;
      return effectValue;
    }
  };
  return {..._,vals:[ch,effectNum,midiEffect.getValue()]};
};

/**
 * Random variation within range(s) at frequency.
 * @param {number} value - Base value to vary.
 * @param {number[]} [boostRange=[.05,.10]] - Boost range multiplier.
 * @param {number} [frequency=.05] - Probability of variation (0-1).
 * @param {number[]} [deboostRange=boostRange] - Deboost range multiplier.
 * @returns {number} Varied value.
 * @example
 * // 5% variation, 5% chance
 * rv(100)
 * @example
 * // 10-20% variation, 10% chance
 * rv(100, [.1, .2], .1)
 */
rv=randomVariation=(value,boostRange=[.05,.10],frequency=.05,deboostRange=boostRange)=>{let factor;
  const singleRange=Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange=singleRange.length===2 && typeof singleRange[0]==='number' && typeof singleRange[1]==='number';
  if (isSingleRange) {  const variation=rf(...singleRange);
    factor=rf() < frequency ? 1 + variation : 1;
  } else {  const range=rf() < .5 ? boostRange : deboostRange;
    factor=rf() < frequency ? 1 + rf(...range) : 1;  }
  return value * factor;
};

/**
 * Normalize Weights: Any sized list of weights with any values are normalized to fit inclusive range.
 * @param {number[]} weights - Array of weight values.
 * @param {number} min - Minimum output value.
 * @param {number} max - Maximum output value.
 * @param {number} [variationLow=.7] - Lower variation multiplier.
 * @param {number} [variationHigh=1.3] - Upper variation multiplier.
 * @returns {number[]} Normalized weights summing to fit range.
 */
normalizeWeights = (weights, min, max, variationLow=.7, variationHigh=1.3) => {
  // Validate weights are non-negative
  if (!weights.every(w => w >= 0)) {
    console.warn('normalizeWeights: negative weights detected, using absolute values');
    weights = weights.map(w => m.abs(w));
  }
  const range = max - min + 1;
  let w = weights.map(weight => weight * rf(variationLow, variationHigh));
  if (w.length !== range) {
    if (w.length < range) {
      const newWeights = [];
      for (let i = 0; i < range; i++) {
        const fraction = i / (range - 1);
        const lowerIndex = m.floor(fraction * (w.length - 1));
        const upperIndex = m.min(lowerIndex + 1, w.length - 1);
        const weightDiff = w[upperIndex] - w[lowerIndex];
        const interpolatedWeight = w[lowerIndex] + (fraction * (w.length - 1) - lowerIndex) * weightDiff;
        newWeights.push(interpolatedWeight);
      }
      w = newWeights;
    } else {
      const groupSize = m.floor(w.length / range);
      w = Array(range).fill(0).map((_, i) => {
        const startIndex = i * groupSize;
        const endIndex = m.min(startIndex + groupSize, w.length);
        return w.slice(startIndex, endIndex).reduce((sum, w) => sum + w, 0) / (endIndex - startIndex);
      });
    }
  }
  const totalWeight = w.reduce((acc, w) => acc + w, 0);
  return w.map(w => w / totalWeight);
};

/**
 * Random weighted selection in inclusive range.
 * @param {number} min - Minimum value.
 * @param {number} max - Maximum value.
 * @param {number[]} weights - Weight array matching range size.
 * @returns {number} Selected value from range.
 */
rw = randomWeightedInRange = (min, max, weights) => {
  const normalizedWeights = normalizeWeights(weights, min, max);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
};

/**
 * Random weighted selection from array.
 * @param {number[]} weights - Weight array matching array length.
 * @returns {number} Selected index.
 */
randomWeightedInArray = (weights) => {
  const normalizedWeights = normalizeWeights(weights, 0, weights.length - 1);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i;
  }
  return weights.length - 1;
};

/**
 * Random weighted selection from options object.
 * @param {Object} options - Options with weighted properties.
 * @returns {string} Selected option key.
 */
randomWeightedSelection = (options) => {
  const types = Object.keys(options);
  const weights = types.map(type => options[type].weights[0]);
  const normalizedWeights = normalizeWeights(weights, 0, types.length - 1);
  const selectedIndex = rw(0, types.length - 1, normalizedWeights);
  return types[selectedIndex];
};

/**
 * Provide params as a function for range, otherwise returns random value from array.
 * @param {number|number[]|Function} v - Can be: (1) number range array [min, max], (2) array of values to select from, (3) function returning a range, or (4) single number (returned as-is).
 * @returns {number|*} Random value from range/array, or original value if single number.
 * @example
 * // Random from array
 * ra([1, 2, 3])
 * @example
 * // Random from function range
 * ra(() => [1, 10])
 */
ra=randomInRangeOrArray = (v) => {
  if (typeof v === 'function') {
    const result = v();
    if (Array.isArray(result) && result.length === 2 && typeof result[0] === 'number' && typeof result[1] === 'number') {
      return ri(result[0], result[1]);
    }
    return Array.isArray(result) ? ra(result) : result;
  } else if (Array.isArray(v)) {
    return v[ri(v.length - 1)];
  }
  return v;
};

// Reset indices helper: reset an index and all of its child indices by unit kind
resetIndexWithChildren = (unit) => {
  switch (unit) {
    case 'section':
      phraseIndex = measureIndex = beatIndex = divIndex = subdivIndex = subsubdivIndex = 0; phrasesPerSection = undefined; measuresPerPhrase = undefined; numerator = undefined; divsPerBeat = undefined; subdivsPerDiv = undefined; subsubsPerSub = undefined; break;
    case 'phrase':
      measureIndex = beatIndex = divIndex = subdivIndex = subsubdivIndex = 0; measuresPerPhrase = undefined; numerator = undefined; divsPerBeat = undefined; subdivsPerDiv = undefined; subsubsPerSub = undefined; break;
    case 'measure':
      beatIndex = divIndex = subdivIndex = subsubdivIndex = 0; numerator = undefined; divsPerBeat = undefined; subdivsPerDiv = undefined; subsubsPerSub = undefined; break;
    case 'beat':
      // Reset indices and clear derived totals so children recompute values on entry
      divIndex = subdivIndex = subsubdivIndex = 0; divsPerBeat = undefined; subdivsPerDiv = undefined; subsubsPerSub = undefined; break;
    case 'division':
      subdivIndex = subsubdivIndex = 0; subdivsPerDiv = undefined; subsubsPerSub = undefined; break;
    case 'subdiv':
      subsubdivIndex = 0; subsubsPerSub = undefined; break;
    case 'subsubdiv':
      subsubdivIndex = 0; break;
    default:
      break;
  }

  // Diagnostic: record when indices are reset so we can correlate resets with anomalies
  try {
    const _fs = require('fs'); const _path = require('path');
    const record = {
      when: new Date().toISOString(),
      unit,
      indices: { sectionIndex, phraseIndex, measureIndex, beatIndex, divIndex, subdivIndex, subsubdivIndex },
      stack: (() => { try { return (new Error()).stack.split('\n').slice(2).map(s => s.trim()); } catch (_e) { return []; } })()
    };
    try { writeDebugFile('reset-index-log.ndjson', record); } catch (_e) { /* swallow */ }
  } catch (_e) { /* swallow */ }

  // Clear any emitted child unit records from the active layer when resetting higher-level units
  try {
    const layer = (LM && LM.activeLayer) ? LM.activeLayer : 'primary';
    const unitsToDrop = {
      section: ['section','phrase','measure','beat','division','subdiv','subsubdiv'],
      phrase: ['measure','beat','division','subdiv','subsubdiv'],
      measure: ['beat','division','subdiv','subsubdiv'],
      beat: ['division','subdiv','subsubdiv'],
      division: ['subdiv','subsubdiv'],
      subdiv: ['subsubdiv'],
      subsubdiv: []
    };
    if (LM && LM.layers && LM.layers[layer] && Array.isArray(LM.layers[layer].state.units)) {
      LM.layers[layer].state.units = LM.layers[layer].state.units.filter(u => !unitsToDrop[unit] || !unitsToDrop[unit].includes(u.unitType));
      try { writeDebugFile('reset-index-log.ndjson', { when: new Date().toISOString(), action: 'cleared-units', unit, layer, remaining: LM.layers[layer].state.units.length }); } catch (_e) { /* swallow */ }
    }
  } catch (_e) { /* swallow */ }
};

// Timing and counter variables (documented inline for brevity)
measureCount=spMeasure=subsubdivStart=subdivStart=beatStart=divStart=sectionStart=sectionStartTime=sectionEnd=tpMeasure=tpBeat=tpDiv=tpSubdiv=tpSubsubdiv=subdivStartTime=subsubdivStartTime=tpSubsubdiv=tpSection=spSection=finalTick=bestMatch=polyMeterRatio=polyNumerator=tpSec=finalTime=endTime=phraseStart=tpPhrase1=tpPhrase2=phraseStartTime=spPhrase=measuresPerPhrase=measuresPerPhrase1=measuresPerPhrase1=measuresPerPhrase2=subdivsPerMinute=subsubsPerMinute=numerator=denominator=subsubsPerSub=meterRatio=divsPerBeat=subdivsPerBeat=subdivsPerDiv=measureStart=measureStartTime=beatsUntilBinauralShift=beatCount=beatsOn=beatsOff=divsOn=divsOff=subdivsOn=subdivsOff=subsubdivsOn=subsubdivsOff=noteCount=beatRhythm=divRhythm=subdivRhythm=subsubdivRhythm=subsubsPerSub=balOffset=sideBias=firstLoop=lastCrossMod=bpmRatio=sectionIndex=phraseIndex=phrasesPerSection=totalSections=measureIndex=beatIndex=divIndex=subdivIndex=subsubdivIndex=0;

composer = null; activeMotif = null; currentSectionType = null; currentSectionDynamics = null;

/**
 * Cross-modulation factor for polyrhythmic interference.
 * @type {number}
 */
crossModulation=2.2;

/**
 * Last used meter configuration.
 * @type {number[]}
 */
lastMeter=[4,4];

/**
 * Sets tracking used MIDI channels to avoid repetition.
 * @type {Set<number>}
 */
lastUsedCHs=new Set();
lastUsedCHs2=new Set();
lastUsedCHs3=new Set();

/**
 * Default MIDI velocity.
 * @type {number}
 */
velocity=99;

/**
 * Toggle for binaural beat channel flip.
 * @type {boolean}
 */
flipBin=false;

/**
 * Neutral pitch bend value (center of pitch bend range).
 * @type {number}
 */
neutralPitchBend=8192;

/**
 * Semitone value in pitch bend units.
 * @type {number}
 */
semitone=neutralPitchBend / 2;

/**
 * Convert cents to tuning frequency offset.
 * @type {number}
 */
let centsToTuningFreq = 1200 * m.log2(TUNING_FREQ / 440);

/**
 * Pitch bend value for tuning frequency.
 * @type {number}
 */
tuningPitchBend=m.round(neutralPitchBend + (semitone * (centsToTuningFreq / 100)));

/**
 * Generate binaural frequency offset.
 * @type {number}
 */
let binauralFreqOffset = rf(BINAURAL.min, BINAURAL.max);

/**
 * Calculate binaural offset pitch bend values.
 * @param {number} plusOrMinus - Direction multiplier (+1 or -1).
 * @returns {number} Pitch bend value.
 */
binauralOffset=(plusOrMinus)=>{
  return m.round(tuningPitchBend + semitone * (12 * m.log2((TUNING_FREQ + plusOrMinus * binauralFreqOffset) / TUNING_FREQ)));
};

/**
 * Binaural pitch bend values for + and - frequencies.
 * @type {number[]}
 */
[binauralPlus,binauralMinus]=[1,-1].map(binauralOffset);

/**
 * MIDI channel constants for center channels.
 * @type {number}
 */
cCH1=0;cCH2=1;lCH1=2;rCH1=3;lCH3=4;rCH3=5;lCH2=6;rCH2=7;lCH4=8;drumCH=9;rCH4=10;cCH3=11;lCH5=12;rCH5=13;lCH6=14;rCH6=15;

/**
 * Bass channel assignments.
 * @type {number[]}
 */
bass=[cCH3,lCH5,rCH5,lCH6,rCH6];

/**
 * Bass channels for binaural processing.
 * @type {number[]}
 */
bassBinaural=[lCH5,rCH5,lCH6,rCH6];

/**
 * Primary source channel assignments.
 * @type {number[]}
 */
source=[cCH1,lCH1,lCH2,rCH1,rCH2];

/**
 * Extended source channels including drums.
 * @type {number[]}
 */
source2=[cCH1,lCH1,lCH2,rCH1,rCH2,drumCH];

/**
 * Reflection channel assignments (creates space/depth).
 * @type {number[]}
 */
reflection=[cCH2,lCH3,lCH4,rCH3,rCH4];

/**
 * Reflection channels for binaural processing.
 * @type {number[]}
 */
reflectionBinaural=[lCH3,lCH4,rCH3,rCH4];

/**
 * Source-to-reflection channel mapping (first reflection layer).
 * @type {Object.<number, number>}
 */
reflect={[cCH1]:cCH2,[lCH1]:lCH3,[rCH1]:rCH3,[lCH2]:lCH4,[rCH2]:rCH4};

/**
 * Source-to-reflection channel mapping (second reflection layer).
 * @type {Object.<number, number>}
 */
reflect2={[cCH1]:cCH3,[lCH1]:lCH5,[rCH1]:rCH5,[lCH2]:lCH6,[rCH2]:rCH6};

/**
 * Left channel assignments for binaural beats.
 * @type {number[]}
 */
binauralL=[lCH1,lCH2,lCH3,lCH4,lCH5,lCH6];

/**
 * Right channel assignments for binaural beats.
 * @type {number[]}
 */
binauralR=[rCH1,rCH2,rCH3,rCH4,rCH5,rCH6];

/**
 * Flip binaural mapping (front configuration).
 * @type {number[]}
 */
flipBinF=[cCH1,cCH2,cCH3,lCH1,rCH1,lCH3,rCH3,lCH5,rCH5];

/**
 * Flip binaural mapping (top configuration).
 * @type {number[]}
 */
flipBinT=[cCH1,cCH2,cCH3,lCH2,rCH2,lCH4,rCH4,lCH6,rCH6];

/**
 * Flip binaural mapping (front config, 2nd layer).
 * @type {number[]}
 */
flipBinF2=[lCH1,rCH1,lCH3,rCH3,lCH5,rCH5];

/**
 * Flip binaural mapping (top config, 2nd layer).
 * @type {number[]}
 */
flipBinT2=[lCH2,rCH2,lCH4,rCH4,lCH6,rCH6];

/**
 * Flip binaural mapping (front config, 3rd layer).
 * @type {number[]}
 */
flipBinF3=[cCH2,cCH3,lCH1,rCH1,lCH3,rCH3,lCH5,rCH5];

/**
 * Flip binaural mapping (top config, 3rd layer).
 * @type {number[]}
 */
flipBinT3=[cCH2,cCH3,lCH2,rCH2,lCH4,rCH4,lCH6,rCH6];

/**
 * Channels available for stutter fade effects.
 * @type {number[]}
 */
stutterFadeCHs=[cCH2,cCH3,lCH1,rCH1,lCH2,rCH2,lCH3,rCH3,lCH4,rCH4,lCH5,rCH5,lCH6,rCH6];

/**
 * All available MIDI channels.
 * @type {number[]}
 */
allCHs=[cCH1,cCH2,cCH3,lCH1,rCH1,lCH2,rCH2,lCH3,rCH3,lCH4,rCH4,lCH5,rCH5,lCH6,rCH6,drumCH];

/**
 * Channels for stutter pan effects.
 * @type {number[]}
 */
stutterPanCHs=[cCH1,cCH2,cCH3,drumCH];

/**
 * MIDI CC effect numbers supported.
 * @type {number[]}
 */
FX=[1,5,11,65,67,68,69,70,71,72,73,74,91,92,93,94,95];

/**
 * Send All Notes Off CC (123) to prevent sustain across transitions.
 * @param {number} [tick=measureStart] - Tick position for All Notes Off.
 * @returns {Array} Array of CC events.
 */
allNotesOff=(tick=measureStart)=>{return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,123,0]  })));}

/**
 * Send Mute All CC (120) to silence all channels.
 * @param {number} [tick=measureStart] - Tick position for Mute All.
 * @returns {Array} Array of CC events.
 */
muteAll=(tick=measureStart)=>{return p(c,...allCHs.map(ch=>({tick:m.max(0,tick-1),type:'control_c',vals:[ch,120,0]  })));}

// Export helpers to centralized test hooks (preferred over global mutation)
const TEST = require('./test-hooks');
try { if (TEST) { TEST.rf = rf; TEST.ri = ri; TEST.clamp = clamp; TEST.rv = rv; TEST.ra = ra; } } catch (e) { /* swallow */ }
