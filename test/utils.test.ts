import { describe, it, expect } from 'vitest';
import { clamp, modClamp } from '../src/utils';

describe('utils', () => {
  describe('clamp', () => {
    it('should clamp value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle edge values', () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });

    it('should work with negative ranges', () => {
      expect(clamp(-5, -10, -1)).toBe(-5);
      expect(clamp(-15, -10, -1)).toBe(-10);
      expect(clamp(0, -10, -1)).toBe(-1);
    });
  });

  describe('modClamp', () => {
    it('should wrap values using modulo', () => {
      expect(modClamp(5, 0, 10)).toBe(5);
      expect(modClamp(15, 0, 10)).toBe(4); // wraps: 15-11=4
      expect(modClamp(-5, 0, 10)).toBe(6); // wraps: -5+11=6
    });

    it('should handle edge cases', () => {
      expect(modClamp(0, 0, 10)).toBe(0);
      expect(modClamp(11, 0, 10)).toBe(0); // wraps to min
    });

    it('should work with different ranges', () => {
      expect(modClamp(8, 0, 4)).toBe(3); // 8 % 5 = 3
      expect(modClamp(9, 0, 4)).toBe(4); // 9 % 5 = 4, clamped at 4
    });
  });
});
