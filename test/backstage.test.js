// test/backstage.test.js
require('../sheet');  // Load constants like TUNING_FREQ, BINAURAL, etc.
require('../backstage');  // Load all backstage functions globally

// Setup function
function setupGlobalState() {
  globalThis.c = [];
  globalThis.csvRows = [];
}

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

describe('LayerManager (LM)', () => {
  beforeEach(() => {
    setupGlobalState();
    // Reset LM state
    LM.layers = {};
    LM.activeLayer = null;
    // Set up global timing variables
    globalThis.numerator = 4;
    globalThis.denominator = 4;
    globalThis.tpSec = 960;
    globalThis.tpMeasure = 1920;
    globalThis.measuresPerPhrase = 4;
    globalThis.tpPhrase = 7680;
    globalThis.spPhrase = 8;
    globalThis.phraseStart = 0;
    globalThis.phraseStartTime = 0;
    globalThis.sectionStart = 0;
    globalThis.sectionStartTime = 0;
    globalThis.sectionEnd = 0;
    globalThis.tpSection = 0;
    globalThis.spSection = 0;
  });

  describe('register', () => {
    it('should register a new layer with buffer', () => {
      const { state, buffer } = LM.register('test', [], {}, () => {});
      expect(LM.layers.test).toBeDefined();
      expect(LM.layers.test.buffer).toBe(buffer);
      expect(state).toBeDefined();
      expect(buffer).toEqual([]);
    });

    it('should create buffer if name provided instead of array', () => {
      const { state, buffer } = LM.register('test2', 'c1', {}, () => {});
      expect(LM.layers.test2).toBeDefined();
      expect(state.bufferName).toBe('c1');
      expect(Array.isArray(buffer)).toBe(true);
    });

    it('should initialize default state properties', () => {
      const { state } = LM.register('test', [], {}, () => {});
      expect(state.phraseStart).toBe(0);
      expect(state.phraseStartTime).toBe(0);
      expect(state.numerator).toBe(4);
      expect(state.denominator).toBe(4);
      expect(state.measuresPerPhrase).toBe(1);
      expect(state.tpMeasure).toBe(PPQ * 4);
    });

    it('should merge initial state with defaults', () => {
      const initialState = { numerator: 3, phraseStart: 100 };
      const { state } = LM.register('test', [], initialState, () => {});
      expect(state.numerator).toBe(3);
      expect(state.phraseStart).toBe(100);
      expect(state.denominator).toBe(4); // default
    });

    it('should call setup function with state and buffer', () => {
      const setupFn = vi.fn();
      const { state, buffer } = LM.register('test', [], {}, setupFn);
      expect(setupFn).toHaveBeenCalledWith(state, buffer);
    });
  });

  describe('activate', () => {
    beforeEach(() => {
      LM.register('primary', [], {}, () => {});
      LM.register('poly', [], {}, () => {});
    });

    it('should set active layer and buffer', () => {
      LM.activate('primary');
      expect(LM.activeLayer).toBe('primary');
      expect(c).toBe(LM.layers.primary.buffer);
    });

    it('should restore layer timing state to globals', () => {
      LM.layers.primary.state.phraseStart = 1000;
      LM.layers.primary.state.phraseStartTime = 1.5;
      LM.layers.primary.state.sectionStart = 500;
      LM.layers.primary.state.tpSection = 2000;
      LM.layers.primary.state.spSection = 2.0;

      LM.activate('primary');

      expect(phraseStart).toBe(1000);
      expect(phraseStartTime).toBe(1.5);
      expect(sectionStart).toBe(500);
      expect(tpSection).toBe(2000);
      expect(spSection).toBe(2.0);
    });

    it('should store current meter values from globals', () => {
      globalThis.numerator = 7;
      globalThis.denominator = 8;
      globalThis.tpSec = 1000;
      globalThis.tpMeasure = 1750;

      LM.activate('primary');

      expect(LM.layers.primary.state.numerator).toBe(7);
      expect(LM.layers.primary.state.denominator).toBe(8);
      expect(LM.layers.primary.state.tpSec).toBe(1000);
      expect(LM.layers.primary.state.tpMeasure).toBe(1750);
    });

    it('should handle poly activation with different meter', () => {
      globalThis.polyNumerator = 5;
      globalThis.polyDenominator = 6;

      LM.activate('poly', true);

      expect(numerator).toBe(5);
      expect(denominator).toBe(6);
    });

    it('should return activation state object', () => {
      const result = LM.activate('primary');
      expect(result).toHaveProperty('phraseStart', 0);
      expect(result).toHaveProperty('phraseStartTime', 0);
      expect(result).toHaveProperty('state');
    });
  });

  describe('advance', () => {
    beforeEach(() => {
      LM.register('primary', [], {}, () => {});
      LM.register('poly', [], {}, () => {});
      LM.activate('primary');
    });

    it('should advance phrase correctly', () => {
      LM.layers.primary.state.phraseStart = 1000;
      LM.layers.primary.state.phraseStartTime = 1.5;
      LM.layers.primary.state.tpSection = 500;
      LM.layers.primary.state.spSection = 0.5;

      LM.advance('primary', 'phrase');

      expect(LM.layers.primary.state.phraseStart).toBe(1000 + tpPhrase);
      expect(LM.layers.primary.state.phraseStartTime).toBe(1.5 + spPhrase);
      expect(LM.layers.primary.state.tpSection).toBe(500 + tpPhrase);
      expect(LM.layers.primary.state.spSection).toBe(0.5 + spPhrase);
    });

    it('should advance section correctly', () => {
      LM.layers.primary.state.sectionStart = 2000;
      LM.layers.primary.state.sectionStartTime = 3.0;
      LM.layers.primary.state.sectionEnd = 4000;
      LM.layers.primary.state.tpSection = 1000;
      LM.layers.primary.state.spSection = 1.0;

      LM.advance('primary', 'section');

      expect(LM.layers.primary.state.sectionStart).toBe(2000 + 1000);
      expect(LM.layers.primary.state.sectionStartTime).toBe(3.0 + 1.0);
      expect(LM.layers.primary.state.sectionEnd).toBe(4000 + 1000);
      expect(LM.layers.primary.state.tpSection).toBe(0);
      expect(LM.layers.primary.state.spSection).toBe(0);
    });

    it('should update meter values from globals', () => {
      globalThis.numerator = 5;
      globalThis.denominator = 6;
      globalThis.measuresPerPhrase = 3;
      globalThis.tpPhrase = 5000;
      globalThis.spPhrase = 5.0;

      LM.advance('primary', 'phrase');

      expect(LM.layers.primary.state.numerator).toBe(5);
      expect(LM.layers.primary.state.denominator).toBe(6);
      expect(LM.layers.primary.state.measuresPerPhrase).toBe(3);
      expect(LM.layers.primary.state.tpPhrase).toBe(5000);
      expect(LM.layers.primary.state.spPhrase).toBe(5.0);
    });

    it('should handle non-existent layer gracefully', () => {
      expect(() => LM.advance('nonexistent')).not.toThrow();
    });

    it('should reset beatRhythm, divRhythm, subdivRhythm', () => {
      globalThis.beatRhythm = 1;
      globalThis.divRhythm = 1;
      globalThis.subdivRhythm = 1;

      LM.advance('primary', 'phrase');

      expect(beatRhythm).toBe(0);
      expect(divRhythm).toBe(0);
      expect(subdivRhythm).toBe(0);
    });
  });

  describe('integration', () => {
    it('should maintain separate state between layers', () => {
      LM.register('layer1', [], {}, () => {});
      LM.register('layer2', [], {}, () => {});

      LM.activate('layer1');
      phraseStart = 100;
      LM.advance('layer1', 'phrase');

      LM.activate('layer2');
      phraseStart = 200;
      LM.advance('layer2', 'phrase');

      // Check layer1 state unchanged
      expect(LM.layers.layer1.state.phraseStart).toBe(tpPhrase);
      expect(LM.layers.layer2.state.phraseStart).toBe(tpPhrase);
    });

    it('should handle complex timing scenarios', () => {
      LM.register('complex', [], {}, () => {});

      // Simulate multiple phrase advances
      LM.activate('complex');
      for (let i = 0; i < 3; i++) {
        LM.advance('complex', 'phrase');
      }

      expect(LM.layers.complex.state.phraseStart).toBe(tpPhrase * 3);
      expect(LM.layers.complex.state.phraseStartTime).toBe(spPhrase * 3);
    });
  });
});

describe('Probabilistic behavior', () => {
  it('should distribute random values uniformly', () => {
    const buckets = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) {
      const value = ri(0, 4);
      buckets[value]++;
    }
    // Each bucket should have roughly 1000 ± 450
    buckets.forEach(count => {
      expect(count).toBeGreaterThan(550);
      expect(count).toBeLessThan(1450);
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