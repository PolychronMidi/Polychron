// clamps.js - Various clamping utilities for numerical value constraints.

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
  const upperBound=m.min(maxBound,m.ceil(base * upperScale));
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
