/**
 * Utilities.ts - ES6 default exports for core utility functions
 * Reduces dependency on globals and enables tree-shaking
 * 
 * Primary consumers: rf, ri, m (Math), clamp variants, random variants
 * These can now be imported directly: import { rf, ri } from './utils.js'
 */

const m = Math;

/**
 * Clamp a value within [min, max] range.
 */
export const clamp = (value: number, min: number, max: number): number => {
  if (min > max) [min, max] = [max, min];
  return m.min(m.max(value, min), max);
};

/**
 * Modulo-based clamp: Value wraps around within range.
 */
export const modClamp = (value: number, min: number, max: number): number => {
  if (min > max) [min, max] = [max, min];
  const range = max - min + 1;
  if (range <= 0) return min;
  return ((value - min) % range + range) % range + min;
};

/**
 * Regular clamp at high end, modClamp at low end.
 */
export const lowModClamp = (value: number, min: number, max: number): number => {
  if (value >= max) return max;
  else if (value < min) return modClamp(value, min, max);
  else return value;
};

/**
 * Regular clamp at low end, modClamp at high end.
 */
export const highModClamp = (value: number, min: number, max: number): number => {
  if (value <= min) return min;
  else if (value > max) return modClamp(value, min, max);
  else return value;
};

/**
 * Scale-based clamp with dynamic bounds.
 */
export const scaleClamp = (value: number, min: number, max: number, factor: number, maxFactor: number = factor, base: number = value): number => {
  const scaledMin = m.max(min * factor, min);
  const scaledMax = m.min(max * maxFactor, max);
  const lowerBound = m.max(min, m.floor(base * factor));
  const upperBound = m.min(max, m.ceil(base * maxFactor));
  return clamp(value, lowerBound, upperBound);
};

/**
 * Scale-based clamp with explicit bounds.
 */
export const scaleBoundClamp = (value: number, base: number, lowerScale: number, upperScale: number, minBound: number = 2, maxBound: number = 9): number => {
  let lowerBound = m.max(minBound, m.floor(base * lowerScale));
  let upperBound = m.min(maxBound, m.ceil(base * upperScale));
  if (lowerBound > upperBound) lowerBound = upperBound;
  return clamp(value, lowerBound, upperBound);
};

/**
 * Soft clamp with gradual boundary approach.
 */
export const softClamp = (value: number, min: number, max: number, softness: number = 0.1): number => {
  if (value < min) return min + (value - min) * softness;
  if (value > max) return max - (value - max) * softness;
  return value;
};

/**
 * Step-based clamp: Snaps value to nearest step.
 */
export const stepClamp = (value: number, min: number, max: number, step: number): number => {
  const clampedValue = clamp(m.round(value / step) * step, min, max);
  return clampedValue;
};

/**
 * Logarithmic clamp for exponential value ranges.
 */
export const logClamp = (value: number, min: number, max: number, base: number = 10): number => {
  const logMin = m.log(min) / m.log(base);
  const logMax = m.log(max) / m.log(base);
  const logValue = m.log(m.max(value, min)) / m.log(base);
  return m.pow(base, m.min(m.max(logValue, logMin), logMax));
};

/**
 * Exponential clamp for logarithmic value ranges.
 */
export const expClamp = (value: number, min: number, max: number, base: number = m.E): number => {
  const minExp = m.pow(base, min);
  const maxExp = m.pow(base, max);
  const valueExp = m.pow(base, value);
  return m.log(m.min(m.max(valueExp, minExp), maxExp)) / m.log(base);
};

/**
 * Random Float (decimal) inclusive of min(s) & max(s).
 */
export const rf = (min1: number = 1, max1?: number, min2?: number, max2?: number): number => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const totalRange = range1 + range2;
    const rand = m.random() * totalRange;
    if (rand < range1) return m.random() * (range1 + Number.EPSILON) + min1;
    else return m.random() * (range2 + Number.EPSILON) + min2;
  } else return m.random() * (max1 - min1 + Number.EPSILON) + min1;
};

export const randomFloat = rf;

/**
 * Random Integer (whole number) inclusive of min(s) & max(s).
 */
export const ri = (min1: number = 1, max1?: number, min2?: number, max2?: number): number => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1;
    const range2 = max2 - min2;
    const totalRange = range1 + range2;
    const rand = rf() * totalRange;
    if (rand < range1) return clamp(m.round(rf() * range1 + min1), m.ceil(min1), m.floor(max1));
    else return clamp(m.round(rand - range1 + min2), m.ceil(min2), m.floor(max2));
  } else return clamp(m.round(rf() * (max1 - min1) + min1), m.ceil(min1), m.floor(max1));
};

export const randomInt = ri;

/**
 * Random Limited Change: Random value from inclusive range, with limited change per iteration.
 */
export const rl = (currentValue: number, minChange: number, maxChange: number, minValue: number, maxValue: number, type: string = 'i'): number => {
  const adjustedMinChange = m.min(minChange, maxChange);
  const adjustedMaxChange = m.max(minChange, maxChange);
  const newMin = m.max(minValue, currentValue + adjustedMinChange);
  const newMax = m.min(maxValue, currentValue + adjustedMaxChange);
  return type === 'f' ? rf(newMin, newMax) : ri(newMin, newMax);
};

export const randomLimitedChange = rl;

/**
 * Random variation within range(s) at frequency.
 */
export const rv = (value: number, boostRange: number[] = [.05, .10], frequency: number = .05, deboostRange: number[] = boostRange): number => {
  let factor: number;
  const singleRange = Array.isArray(deboostRange) ? deboostRange : boostRange;
  const isSingleRange = singleRange.length === 2 && typeof singleRange[0] === 'number' && typeof singleRange[1] === 'number';
  if (isSingleRange) {
    const variation = rf(...singleRange);
    factor = rf() < frequency ? 1 + variation : 1;
  } else {
    const range = rf() < .5 ? boostRange : deboostRange;
    factor = rf() < frequency ? 1 + rf(...range) : 1;
  }
  return value * factor;
};

export const randomVariation = rv;

/**
 * Normalize Weights: Any sized list of weights with any values are normalized to fit inclusive range.
 */
export const normalizeWeights = (weights: number[], min: number, max: number, variationLow: number = .7, variationHigh: number = 1.3): number[] => {
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
        return w.slice(startIndex, endIndex).reduce((sum, ww) => sum + ww, 0) / (endIndex - startIndex);
      });
    }
  }
  const totalWeight = w.reduce((acc, ww) => acc + ww, 0);
  return w.map(ww => ww / totalWeight);
};

/**
 * Random weighted selection in inclusive range.
 */
export const rw = (min: number, max: number, weights: number[]): number => {
  const normalizedWeights = normalizeWeights(weights, min, max);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
};

export const randomWeightedInRange = rw;

/**
 * Random weighted selection from array.
 */
export const randomWeightedInArray = (weights: number[]): number => {
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
 */
export const randomWeightedSelection = (options: any): string => {
  const types = Object.keys(options);
  const weights = types.map(type => options[type].weights?.[0] ?? 1);
  const normalizedWeights = normalizeWeights(weights, 0, types.length - 1);
  const selectedIndex = rw(0, types.length - 1, normalizedWeights);
  return types[selectedIndex];
};

/**
 * Provide params as a function for range, otherwise returns random value from array.
 */
export const ra = (v: any): any => {
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

export const randomInRangeOrArray = ra;

/**
 * Export Math as default for convenience
 */
export default m;
