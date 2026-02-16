// randoms.js - Random number generation utilities with inclusive ranges and weighted selections.

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
      const change=(newMax-newMin)*rf(.1,.3);
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
    throw new Error('normalizeWeights: negative weights detected - weights must be non-negative');
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
        return w.slice(startIndex, endIndex).reduce((sum, v) => sum + v, 0) / (endIndex - startIndex);
      });
    }
  }
  const totalWeight = w.reduce((acc, v) => acc + v, 0);
  return w.map(v => v / totalWeight);
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
