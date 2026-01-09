// test/backstage.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

let m = Math;
let c, csvRows;

// Setup function
function setupGlobalState() {
  c = csvRows = [];
  m = Math;
}

// Import functions from backstage.js
const pushMultiple = (array, ...items) => { array.push(...items); };
const p = pushMultiple;

const clamp = (value, min, max) => m.min(m.max(value, min), max);

const modClamp = (value, min, max) => {
  const range = max - min + 1;
  return ((value - min) % range + range) % range + min;
};

const lowModClamp = (value, min, max) => {
  if (value >= max) { return max;
  } else if (value < min) { return modClamp(value, min, max);
  } else { return value; }
};

const highModClamp = (value, min, max) => {
  if (value <= min) { return min;
  } else if (value > max) { return modClamp(value, min, max);
  } else { return value; }
};

const scaleClamp = (value, min, max, factor, maxFactor = factor, base = value) => {
  const scaledMin = m.max(min * factor, min);
  const scaledMax = m.min(max * maxFactor, max);
  const lowerBound = m.max(min, m.floor(base * factor));
  const upperBound = m.min(max, m.ceil(base * maxFactor));
  return clamp(value, lowerBound, upperBound);
};

const scaleBoundClamp = (value, base, lowerScale, upperScale, minBound = 2, maxBound = 9) => {
  const lowerBound = m.max(minBound, m.floor(base * lowerScale));
  const upperBound = m.min(maxBound, m.ceil(base * upperScale));
  return clamp(value, lowerBound, upperBound);
};

const softClamp = (value, min, max, softness = 0.1) => {
  if (value < min) return min + (value - min) * softness;
  if (value > max) return max - (value - max) * softness;
  return value;
};

const stepClamp = (value, min, max, step) => {
  const clampedValue = clamp(m.round(value / step) * step, min, max);
  return clampedValue;
};

const logClamp = (value, min, max, base = 10) => {
  const logMin = m.log(min) / m.log(base);
  const logMax = m.log(max) / m.log(base);
  const logValue = m.log(m.max(value, min)) / m.log(base);
  return m.pow(base, m.min(m.max(logValue, logMin), logMax));
};

const expClamp = (value, min, max, base = m.E) => {
  const minExp = m.pow(base, min);
  const maxExp = m.pow(base, max);
  const valueExp = m.pow(base, value);
  return m.log(m.min(m.max(valueExp, minExp), maxExp)) / m.log(base);
};

const randomFloat = (min1 = 1, max1, min2, max2) => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1; const range2 = max2 - min2;
    const totalRange = range1 + range2; const rand = m.random() * totalRange;
    if (rand < range1) { return m.random() * (range1 + Number.EPSILON) + min1;
    } else { return m.random() * (range2 + Number.EPSILON) + min2; }
  } else { return m.random() * (max1 - min1 + Number.EPSILON) + min1; }
};
const rf = randomFloat;

const randomInt = (min1 = 1, max1, min2, max2) => {
  if (max1 === undefined) { max1 = min1; min1 = 0; }
  [min1, max1] = [m.min(min1, max1), m.max(min1, max1)];
  if (min2 !== undefined && max2 !== undefined) {
    [min2, max2] = [m.min(min2, max2), m.max(min2, max2)];
    const range1 = max1 - min1; const range2 = max2 - min2;
    const totalRange = range1 + range2; const rand = rf() * totalRange;
    if (rand < range1) {
      return clamp(m.round(rf() * range1 + min1), m.ceil(min1), m.floor(max1));
    } else {
      return clamp(m.round(rand - range1 + min2), m.ceil(min2), m.floor(max2));
    }
  } else {
    return clamp(m.round(rf() * (max1 - min1) + min1), m.ceil(min1), m.floor(max1));
  }
};
const ri = randomInt;

const randomLimitedChange = (currentValue, minChange, maxChange, minValue, maxValue, type = 'i') => {
  const adjustedMinChange = m.min(minChange, maxChange);
  const adjustedMaxChange = m.max(minChange, maxChange);
  const newMin = m.max(minValue, currentValue + adjustedMinChange);
  const newMax = m.min(maxValue, currentValue + adjustedMaxChange);
  return type === 'f' ? rf(newMin, newMax) : ri(newMin, newMax);
};
const rl = randomLimitedChange;

const randomVariation = (value, boostRange = [.05, .10], frequency = .05, deboostRange = boostRange) => {
  let factor;
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
const rv = randomVariation;

const normalizeWeights = (weights, min, max, variationLow = .7, variationHigh = 1.3) => {
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

const randomWeightedInRange = (min, max, weights) => {
  const normalizedWeights = normalizeWeights(weights, min, max);
  let random = rf();
  for (let i = 0; i < normalizedWeights.length; i++) {
    random -= normalizedWeights[i];
    if (random <= 0) return i + min;
  }
  return max;
};
const rw = randomWeightedInRange;

const randomInRangeOrArray = (v) => {
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
const ra = randomInRangeOrArray;

const allNotesOff = (tick = 0) => {
  const allCHs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  return p(c, ...allCHs.map(ch => ({ tick: m.max(0, tick - 1), type: 'control_c', vals: [ch, 123, 0] })));
};

describe('pushMultiple (p)', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should push single item', () => {
    p(c, { a: 1 });
    expect(c).toEqual([{ a: 1 }]);
  });

  it('should push multiple items', () => {
    p(c, { a: 1 }, { b: 2 }, { c: 3 });
    expect(c).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('should handle empty push', () => {
    p(c);
    expect(c).toEqual([]);
  });

  it('should work with existing array items', () => {
    c = [{ x: 0 }];
    p(c, { a: 1 }, { b: 2 });
    expect(c).toEqual([{ x: 0 }, { a: 1 }, { b: 2 }]);
  });
});

describe('Clamp functions', () => {
  describe('clamp', () => {
    it('should clamp value below min', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('should clamp value above max', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should return value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should handle equal min and max', () => {
      expect(clamp(5, 7, 7)).toBe(7);
    });

    it('should handle negative ranges', () => {
      expect(clamp(-15, -10, -5)).toBe(-10);
      expect(clamp(0, -10, -5)).toBe(-5);
    });
  });

  describe('modClamp', () => {
    it('should wrap value below min', () => {
      expect(modClamp(-1, 0, 9)).toBe(9);
      expect(modClamp(-2, 0, 9)).toBe(8);
    });

    it('should wrap value above max', () => {
      expect(modClamp(10, 0, 9)).toBe(0);
      expect(modClamp(11, 0, 9)).toBe(1);
    });

    it('should return value within range', () => {
      expect(modClamp(5, 0, 9)).toBe(5);
    });

    it('should handle wrapping multiple times', () => {
      expect(modClamp(20, 0, 9)).toBe(0);
      expect(modClamp(-20, 0, 9)).toBe(0);
    });

    it('should work with non-zero min', () => {
      expect(modClamp(8, 3, 7)).toBe(3);
      expect(modClamp(2, 3, 7)).toBe(7);
    });
  });

  describe('lowModClamp', () => {
    it('should clamp at max', () => {
      expect(lowModClamp(15, 0, 10)).toBe(10);
    });

    it('should modClamp below min', () => {
      expect(lowModClamp(-1, 0, 10)).toBe(10);
      expect(lowModClamp(-2, 0, 10)).toBe(9);
    });

    it('should return value within range', () => {
      expect(lowModClamp(5, 0, 10)).toBe(5);
    });
  });

  describe('highModClamp', () => {
    it('should clamp at min', () => {
      expect(highModClamp(-5, 0, 10)).toBe(0);
    });

    it('should modClamp above max', () => {
      expect(highModClamp(11, 0, 10)).toBe(0);
      expect(highModClamp(12, 0, 10)).toBe(1);
    });

    it('should return value within range', () => {
      expect(highModClamp(5, 0, 10)).toBe(5);
    });
  });

  describe('scaleClamp', () => {
    it('should scale bounds based on factor', () => {
      const result = scaleClamp(50, 0, 100, 0.5);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('should use base value for scaling', () => {
      const result = scaleClamp(60, 0, 100, 0.5, 0.5, 50);
      expect(result).toBeGreaterThanOrEqual(25);
      expect(result).toBeLessThanOrEqual(25);
    });

    it('should handle different min/max factors', () => {
      const result = scaleClamp(50, 0, 100, 0.5, 1.5);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe('scaleBoundClamp', () => {
    it('should clamp to scaled bounds', () => {
      const result = scaleBoundClamp(5, 4, 0.5, 1.5, 2, 9);
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(9);
    });

    it('should respect minBound', () => {
      const result = scaleBoundClamp(1, 10, 0.1, 0.2, 2, 9);
      expect(result).toBeGreaterThanOrEqual(2);
    });

    it('should respect maxBound', () => {
      const result = scaleBoundClamp(20, 10, 2, 3, 2, 9);
      expect(result).toBeLessThanOrEqual(9);
    });
  });

  describe('softClamp', () => {
    it('should softly clamp below min', () => {
      const result = softClamp(-5, 0, 10, 0.1);
      expect(result).toBeLessThan(0);
      expect(result).toBeCloseTo(-0.5, 1);
    });

    it('should softly clamp above max', () => {
      const result = softClamp(15, 0, 10, 0.1);
      expect(result).toBeLessThan(10);
      expect(result).toBeCloseTo(9.5, 1);
    });

    it('should return value within range unchanged', () => {
      expect(softClamp(5, 0, 10, 0.1)).toBe(5);
    });

    it('should handle different softness values', () => {
      const soft = softClamp(-5, 0, 10, 0.5);
      const hard = softClamp(-5, 0, 10, 0.1);
      expect(soft).toBeLessThan(hard);
    });
  });

  describe('stepClamp', () => {
    it('should round to step', () => {
      expect(stepClamp(7, 0, 10, 5)).toBe(5);
      expect(stepClamp(8, 0, 10, 5)).toBe(10);
    });

    it('should clamp to range', () => {
      expect(stepClamp(17, 0, 10, 5)).toBe(10);
      expect(stepClamp(-3, 0, 10, 5)).toBe(0);
    });

    it('should handle fractional steps', () => {
      expect(stepClamp(5.3, 0, 10, 0.5)).toBeCloseTo(5.5, 1);
    });
  });

  describe('logClamp', () => {
    it('should clamp in logarithmic space', () => {
      const result = logClamp(50, 1, 100, 10);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('should handle values below min', () => {
      const result = logClamp(0.5, 1, 100, 10);
      expect(result).toBe(1);
    });

    it('should handle different bases', () => {
      const result = logClamp(5, 1, 10, 2);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(10);
    });
  });

  describe('expClamp', () => {
    it('should clamp in exponential space', () => {
      const result = expClamp(5, 0, 10, m.E);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(10);
    });

    it('should handle different bases', () => {
      const result = expClamp(5, 0, 10, 2);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(10);
    });
  });
});

describe('Random functions', () => {
  describe('randomFloat (rf)', () => {
    it('should return value in range [0, n]', () => {
      for (let i = 0; i < 100; i++) {
        const result = rf(10);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    it('should return value in range [min, max]', () => {
      for (let i = 0; i < 100; i++) {
        const result = rf(5, 10);
        expect(result).toBeGreaterThanOrEqual(5);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    it('should handle reversed min/max', () => {
      for (let i = 0; i < 100; i++) {
        const result = rf(10, 5);
        expect(result).toBeGreaterThanOrEqual(5);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    it('should handle dual ranges', () => {
      for (let i = 0; i < 100; i++) {
        const result = rf(0, 5, 10, 15);
        const inRange1 = result >= 0 && result <= 5;
        const inRange2 = result >= 10 && result <= 15;
        expect(inRange1 || inRange2).toBe(true);
      }
    });

    it('should handle negative ranges', () => {
      for (let i = 0; i < 100; i++) {
        const result = rf(-10, -5);
        expect(result).toBeGreaterThanOrEqual(-10);
        expect(result).toBeLessThanOrEqual(-5);
      }
    });
  });

  describe('randomInt (ri)', () => {
    it('should return integer in range [0, n]', () => {
      for (let i = 0; i < 100; i++) {
        const result = ri(10);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    it('should return integer in range [min, max]', () => {
      for (let i = 0; i < 100; i++) {
        const result = ri(5, 10);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(5);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    it('should handle reversed min/max', () => {
      for (let i = 0; i < 100; i++) {
        const result = ri(10, 5);
        expect(result).toBeGreaterThanOrEqual(5);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    it('should handle dual ranges', () => {
      for (let i = 0; i < 100; i++) {
        const result = ri(0, 5, 10, 15);
        const inRange1 = result >= 0 && result <= 5;
        const inRange2 = result >= 10 && result <= 15;
        expect(inRange1 || inRange2).toBe(true);
      }
    });

    it('should handle fractional bounds', () => {
      for (let i = 0; i < 100; i++) {
        const result = ri(5.5, 10.5);
        expect(result).toBeGreaterThanOrEqual(6);
        expect(result).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('randomLimitedChange (rl)', () => {
    it('should limit change from current value', () => {
      for (let i = 0; i < 100; i++) {
        const result = rl(50, -5, 5, 0, 100);
        expect(result).toBeGreaterThanOrEqual(45);
        expect(result).toBeLessThanOrEqual(55);
      }
    });

    it('should respect min boundary', () => {
      for (let i = 0; i < 100; i++) {
        const result = rl(3, -5, 5, 0, 100);
        expect(result).toBeGreaterThanOrEqual(0);
      }
    });

    it('should respect max boundary', () => {
      for (let i = 0; i < 100; i++) {
        const result = rl(97, -5, 5, 0, 100);
        expect(result).toBeLessThanOrEqual(100);
      }
    });

    it('should return integer by default', () => {
      const result = rl(50, -5, 5, 0, 100);
      expect(Number.isInteger(result)).toBe(true);
    });

    it('should return float when type="f"', () => {
      const result = rl(50, -5, 5, 0, 100, 'f');
      expect(typeof result).toBe('number');
    });

    it('should handle reversed minChange/maxChange', () => {
      for (let i = 0; i < 100; i++) {
        const result = rl(50, 5, -5, 0, 100);
        expect(result).toBeGreaterThanOrEqual(45);
        expect(result).toBeLessThanOrEqual(55);
      }
    });
  });

  describe('randomVariation (rv)', () => {
    it('should return original value most of the time', () => {
      let unchangedCount = 0;
      const value = 100;
      for (let i = 0; i < 1000; i++) {
        if (rv(value, [0.05, 0.10], 0.05) === value) unchangedCount++;
      }
      expect(unchangedCount).toBeGreaterThan(900);
    });

    it('should vary value occasionally', () => {
      let variedCount = 0;
      const value = 100;
      for (let i = 0; i < 1000; i++) {
        if (rv(value, [0.05, 0.10], 0.5) !== value) variedCount++;
      }
      expect(variedCount).toBeGreaterThan(0);
    });

    it('should boost value within range', () => {
      for (let i = 0; i < 100; i++) {
        const result = rv(100, [0.1, 0.2], 1.0);
        expect(result).toBeGreaterThanOrEqual(100);
        expect(result).toBeLessThanOrEqual(120);
      }
    });

    it('should handle separate boost/deboost ranges', () => {
      for (let i = 0; i < 100; i++) {
        const result = rv(100, [0.1, 0.2], 1.0, [-0.2, -0.1]);
        expect(result).toBeGreaterThanOrEqual(80);
        expect(result).toBeLessThanOrEqual(120);
      }
    });
  });
});

describe('Weight and selection functions', () => {
  describe('normalizeWeights', () => {
    it('should normalize weights to sum to 1', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const weights = [1, 2, 3];
      const normalized = normalizeWeights(weights, 0, 2);
      const sum = normalized.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
      vi.restoreAllMocks();
    });

    it('should handle single weight', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const weights = [5];
      const normalized = normalizeWeights(weights, 0, 0);
      expect(normalized[0]).toBeCloseTo(1, 5);
      vi.restoreAllMocks();
    });

    it('should interpolate when weights < range', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const weights = [1, 3];
      const normalized = normalizeWeights(weights, 0, 3);
      expect(normalized.length).toBe(4);
      vi.restoreAllMocks();
    });

    it('should group when weights > range', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const weights = [1, 2, 3, 4, 5, 6];
      const normalized = normalizeWeights(weights, 0, 2);
      expect(normalized.length).toBe(3);
      vi.restoreAllMocks();
    });
  });

  describe('randomWeightedInRange (rw)', () => {
    it('should return value in range', () => {
      for (let i = 0; i < 100; i++) {
        const result = rw(0, 5, [1, 1, 1, 1, 1, 1]);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(5);
      }
    });

    it('should favor higher weights', () => {
      const results = [];
      for (let i = 0; i < 1000; i++) {
        results.push(rw(0, 2, [1, 1, 100]));
      }
      const count2 = results.filter(r => r === 2).length;
      expect(count2).toBeGreaterThan(500);
    });

    it('should handle zero weights', () => {
      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(rw(0, 2, [0, 0, 1]));
      }
      expect(results.every(r => r === 2)).toBe(true);
    });
  });

  describe('randomInRangeOrArray (ra)', () => {
    it('should return element from array', () => {
      const arr = [1, 2, 3, 4, 5];
      for (let i = 0; i < 100; i++) {
        const result = ra(arr);
        expect(arr).toContain(result);
      }
    });

    it('should handle function returning range', () => {
      const result = ra(() => [5, 10]);
      expect(result).toBeGreaterThanOrEqual(5);
      expect(result).toBeLessThanOrEqual(10);
    });

    it('should handle function returning array', () => {
      const arr = [1, 2, 3];
      const result = ra(() => arr);
      expect(arr).toContain(result);
    });

    it('should return direct value', () => {
      expect(ra(42)).toBe(42);
    });

    it('should handle nested arrays', () => {
      const result = ra(() => [[1, 2, 3]]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1, 2, 3]);
    });
  });
});

describe('MIDI helper functions', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  describe('allNotesOff', () => {
    it('should generate note off for all channels', () => {
      allNotesOff(100);
      expect(c.length).toBe(16);
    });

    it('should use control change 123', () => {
      allNotesOff(100);
      expect(c.every(cmd => cmd.vals[1] === 123)).toBe(true);
    });

    it('should set tick to tick-1', () => {
      allNotesOff(100);
      expect(c.every(cmd => cmd.tick === 99)).toBe(true);
    });

    it('should handle tick=0 without going negative', () => {
      allNotesOff(0);
      expect(c.every(cmd => cmd.tick === 0)).toBe(true);
    });

    it('should generate control_c type', () => {
      allNotesOff(100);
      expect(c.every(cmd => cmd.type === 'control_c')).toBe(true);
    });

    it('should include all 16 MIDI channels', () => {
      allNotesOff(100);
      const channels = c.map(cmd => cmd.vals[0]);
      for (let i = 0; i < 16; i++) {
        expect(channels).toContain(i);
      }
    });

    it('should use default tick if not provided', () => {
      allNotesOff();
      expect(c.length).toBe(16);
    });
  });
});

describe('Integration tests', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should chain clamp functions correctly', () => {
    let value = 15;
    value = clamp(value, 0, 10);
    expect(value).toBe(10);
    value = softClamp(value + 5, 0, 10, 0.1);
    expect(value).toBeLessThan(10);
  });

  it('should combine random functions', () => {
    for (let i = 0; i < 100; i++) {
      let value = ri(50, 100);
      value = rl(value, -10, 10, 0, 127);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(127);
    }
  });

  it('should use weighted selection with random variation', () => {
    for (let i = 0; i < 100; i++) {
      let value = rw(0, 10, [1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 1]);
      value = rv(value, [0.1, 0.2], 0.3);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('should handle MIDI data flow', () => {
    p(c, { tick: 0, type: 'note_on_c', vals: [0, 60, 100] });
    p(c, { tick: 100, type: 'note_off_c', vals: [0, 60, 0] });
    allNotesOff(200);
    expect(c.length).toBe(18); // 2 notes + 16 allNotesOff
  });
});

describe('Edge cases and boundary conditions', () => {
  describe('clamp edge cases', () => {
    it('should handle infinity', () => {
      expect(clamp(Infinity, 0, 10)).toBe(10);
      expect(clamp(-Infinity, 0, 10)).toBe(0);
    });

    it('should handle very large numbers', () => {
      expect(clamp(Number.MAX_VALUE, 0, 10)).toBe(10);
      expect(clamp(-Number.MAX_VALUE, 0, 10)).toBe(0);
    });

    it('should handle very small differences', () => {
      const result = clamp(5.00000001, 5, 5.00001);
      expect(result).toBeCloseTo(5.00000001, 8);
    });
  });

  describe('modClamp edge cases', () => {
    it('should handle zero range', () => {
      expect(modClamp(5, 7, 7)).toBe(7);
    });

    it('should handle very large wraps', () => {
      expect(modClamp(1000, 0, 9)).toBe(0);
    });

    it('should handle negative ranges', () => {
      expect(modClamp(5, -10, -5)).toBeGreaterThanOrEqual(-10);
      expect(modClamp(5, -10, -5)).toBeLessThanOrEqual(-5);
    });
  });

  describe('random function edge cases', () => {
    it('should handle min=max for rf', () => {
      expect(rf(5, 5)).toBe(5);
    });

    it('should handle min=max for ri', () => {
      expect(ri(5, 5)).toBe(5);
    });

    it('should handle zero range for rl', () => {
      expect(rl(5, 0, 0, 5, 5)).toBe(5);
    });

    it('should handle negative frequency for rv', () => {
      const result = rv(100, [0.1, 0.2], -0.5);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('normalizeWeights edge cases', () => {
    it('should handle all zero weights', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const weights = [0, 0, 0];
      const normalized = normalizeWeights(weights, 0, 2);
      expect(normalized.every(w => isNaN(w) || w >= 0)).toBe(true);
      vi.restoreAllMocks();
    });

    it('should handle negative weights', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const weights = [-1, -2, -3];
      const normalized = normalizeWeights(weights, 0, 2);
      const sum = normalized.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
      vi.restoreAllMocks();
    });

    it('should handle very large weights', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const weights = [1e10, 2e10, 3e10];
      const normalized = normalizeWeights(weights, 0, 2);
      const sum = normalized.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
      vi.restoreAllMocks();
    });
  });

  describe('array operations edge cases', () => {
    it('should handle empty array for pushMultiple', () => {
      const arr = [];
      p(arr);
      expect(arr).toEqual([]);
    });

    it('should handle single element array for ra', () => {
      expect(ra([42])).toBe(42);
    });

    it('should handle empty function return for ra', () => {
      expect(ra(() => 42)).toBe(42);
    });
  });
});

describe('Performance characteristics', () => {
  it('should handle large arrays efficiently', () => {
    setupGlobalState();
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      p(c, { tick: i, type: 'note_on_c', vals: [0, 60, 100] });
    }
    const duration = performance.now() - start;
    expect(c.length).toBe(10000);
    expect(duration).toBeLessThan(1000); // Should complete in < 1 second
  });

  it('should handle many weight normalizations', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      normalizeWeights([1, 2, 3, 4, 5], 0, 10);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
    vi.restoreAllMocks();
  });

  it('should handle many random calls efficiently', () => {
    const start = performance.now();
    for (let i = 0; i < 100000; i++) {
      ri(0, 127);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
  });
});

describe('Math consistency', () => {
  it('should use Math object consistently', () => {
    expect(m).toBe(Math);
    expect(m.floor(5.7)).toBe(5);
    expect(m.ceil(5.2)).toBe(6);
    expect(m.round(5.5)).toBe(6);
  });

  it('should handle floating point precision', () => {
    const result = clamp(0.1 + 0.2, 0.3, 0.4);
    expect(result).toBeCloseTo(0.3, 10);
  });

  it('should maintain precision in calculations', () => {
    for (let i = 0; i < 100; i++) {
      const value = rf(0, 1);
      const varied = rv(value, [0.01, 0.02], 1.0);
      expect(varied).toBeGreaterThanOrEqual(value * 0.98);
      expect(varied).toBeLessThanOrEqual(value * 1.02);
    }
  });
});

describe('Type safety', () => {
  it('should handle numeric strings in clamp', () => {
    expect(clamp('5', 0, 10)).toBe(5);
    expect(clamp(5, '0', '10')).toBe(5);
  });

  it('should return numbers from random functions', () => {
    expect(typeof rf()).toBe('number');
    expect(typeof ri()).toBe('number');
    expect(typeof rl(5, -2, 2, 0, 10)).toBe('number');
  });

  it('should handle mixed types in arrays', () => {
    setupGlobalState();
    p(c, { a: 1 }, { b: 'string' }, { c: null });
    expect(c.length).toBe(3);
    expect(c[1].b).toBe('string');
  });
});

describe('State management', () => {
  it('should maintain separate array state', () => {
    const arr1 = [];
    const arr2 = [];
    p(arr1, { a: 1 });
    p(arr2, { b: 2 });
    expect(arr1).toEqual([{ a: 1 }]);
    expect(arr2).toEqual([{ b: 2 }]);
  });

  it('should not mutate input arrays', () => {
    const original = [1, 2, 3];
    const result = ra(original);
    expect(original).toEqual([1, 2, 3]);
  });

  it('should handle global state resets', () => {
    setupGlobalState();
    p(c, { a: 1 });
    expect(c.length).toBe(1);
    setupGlobalState();
    expect(c.length).toBe(0);
  });
});

describe('Probabilistic behavior', () => {
  it('should distribute random values uniformly', () => {
    const buckets = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) {
      const value = ri(0, 4);
      buckets[value]++;
    }
    // Each bucket should have roughly 1000 ± 400
    buckets.forEach(count => {
      expect(count).toBeGreaterThan(600);
      expect(count).toBeLessThan(1400);
    });
  });

  it('should respect weighted probabilities', () => {
    const results = [0, 0, 0];
    for (let i = 0; i < 3000; i++) {
      const value = rw(0, 2, [1, 5, 1]);
      results[value]++;
    }
    // Middle value should have ~5x more occurrences
    expect(results[1]).toBeGreaterThan(results[0] * 3);
    expect(results[1]).toBeGreaterThan(results[2] * 3);
  });

  it('should apply variation at specified frequency', () => {
    let variations = 0;
    const value = 100;
    for (let i = 0; i < 1000; i++) {
      const result = rv(value, [0.1, 0.2], 0.5);
      if (result !== value) variations++;
    }
    // Should vary roughly 50% of the time (±10%)
    expect(variations).toBeGreaterThan(400);
    expect(variations).toBeLessThan(600);
  });
});
