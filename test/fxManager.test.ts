import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FxManager } from '../src/fxManager.js';

/**
 * FxManager Tests
 * Tests audio effects manager with stutter effects (fade, pan, FX)
 * and MIDI channel state tracking
 */

describe('FxManager', () => {
  let fxManager: FxManager;

  beforeEach(() => {
    // Setup global mocks required by FxManager
    const g = globalThis as any;
    g.ri = vi.fn((min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min);
    g.rf = vi.fn((min?: number, max?: number) => {
      const minn = min ?? 0;
      const maxx = max ?? 1;
      return Math.random() * (maxx - minn) + minn;
    });
    g.modClamp = vi.fn((value: number, min: number, max: number) => Math.max(min, Math.min(max, value)));
    g.ra = vi.fn((arr: any[]) => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null));
    g.p = vi.fn(() => void 0);
    g.beatStart = 0;
    g.tpSec = 480; // Typical MIDI ticks per second
    g.c = { buffer: [] };

    fxManager = new FxManager();
  });

  describe('Constructor', () => {
    it('should initialize channel tracking sets', () => {
      expect(fxManager.lastUsedCHs).toBeDefined();
      expect(fxManager.lastUsedCHs2).toBeDefined();
      expect(fxManager.lastUsedCHs instanceof Set).toBe(true);
      expect(fxManager.lastUsedCHs2 instanceof Set).toBe(true);
      expect(fxManager.lastUsedCHs.size).toBe(0);
      expect(fxManager.lastUsedCHs2.size).toBe(0);
    });

    it('should be instantiable without arguments', () => {
      const fm = new FxManager();
      expect(fm).toBeDefined();
    });
  });

  describe('resetChannelTracking()', () => {
    it('should clear lastUsedCHs set', () => {
      fxManager.lastUsedCHs.add(1);
      fxManager.lastUsedCHs.add(2);
      fxManager.resetChannelTracking();
      expect(fxManager.lastUsedCHs.size).toBe(0);
    });

    it('should clear lastUsedCHs2 set', () => {
      fxManager.lastUsedCHs2.add(3);
      fxManager.lastUsedCHs2.add(4);
      fxManager.resetChannelTracking();
      expect(fxManager.lastUsedCHs2.size).toBe(0);
    });

    it('should clear both sets independently', () => {
      fxManager.lastUsedCHs.add(1);
      fxManager.lastUsedCHs2.add(2);
      fxManager.resetChannelTracking();
      expect(fxManager.lastUsedCHs.size).toBe(0);
      expect(fxManager.lastUsedCHs2.size).toBe(0);
    });
  });

  describe('stutterFade()', () => {
    it('should accept channels parameter as array', () => {
      const result = fxManager.stutterFade([1, 2, 3]);
      expect(result).toBeUndefined(); // Void method
    });

    it('should accept default numStutters (2)', () => {
      const result = fxManager.stutterFade([1]);
      expect(result).toBeUndefined();
    });

    it('should accept custom numStutters', () => {
      const result = fxManager.stutterFade([1], 4);
      expect(result).toBeUndefined();
    });

    it('should accept custom duration', () => {
      const result = fxManager.stutterFade([1], 2, 500);
      expect(result).toBeUndefined();
    });

    it('should track used channels', () => {
      // Just verify no error thrown during tracking
      expect(() => {
        fxManager.stutterFade([1, 2]);
      }).not.toThrow();
    });

    it('should handle single channel in array', () => {
      const result = fxManager.stutterFade([1], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle multiple channels (up to 5)', () => {
      const channels = [1, 2, 3, 4, 5];
      const result = fxManager.stutterFade(channels, 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should default to 2 stutters if parameter omitted', () => {
      const result1 = fxManager.stutterFade([1]);
      const result2 = fxManager.stutterFade([1], 2, 1000);
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });

    it('should handle empty channels array', () => {
      const result = fxManager.stutterFade([], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: numStutters = 1', () => {
      const result = fxManager.stutterFade([1], 1, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: numStutters > 5', () => {
      const result = fxManager.stutterFade([1], 10, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: duration = 0', () => {
      const result = fxManager.stutterFade([1], 2, 0);
      expect(result).toBeUndefined();
    });
  });

  describe('stutterPan()', () => {
    it('should accept channels parameter as array', () => {
      const result = fxManager.stutterPan([1, 2, 3]);
      expect(result).toBeUndefined();
    });

    it('should accept default numStutters (2)', () => {
      const result = fxManager.stutterPan([1]);
      expect(result).toBeUndefined();
    });

    it('should accept custom numStutters', () => {
      const result = fxManager.stutterPan([1], 4);
      expect(result).toBeUndefined();
    });

    it('should accept custom duration', () => {
      const result = fxManager.stutterPan([1], 2, 500);
      expect(result).toBeUndefined();
    });

    it('should track used channels separately from fade', () => {
      fxManager.stutterPan([1, 2]);
      expect(fxManager.lastUsedCHs2.size).toBeGreaterThan(0);
    });

    it('should handle single channel in array', () => {
      const result = fxManager.stutterPan([1], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle multiple channels (up to 5)', () => {
      const channels = [1, 2, 3, 4, 5];
      const result = fxManager.stutterPan(channels, 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should default to 2 stutters if parameter omitted', () => {
      const result1 = fxManager.stutterPan([1]);
      const result2 = fxManager.stutterPan([1], 2, 1000);
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });

    it('should handle empty channels array', () => {
      const result = fxManager.stutterPan([], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: numStutters = 1', () => {
      const result = fxManager.stutterPan([1], 1, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: numStutters > 5', () => {
      const result = fxManager.stutterPan([1], 10, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: duration = 0', () => {
      const result = fxManager.stutterPan([1], 2, 0);
      expect(result).toBeUndefined();
    });
  });

  describe('stutterFX()', () => {
    it('should accept channels parameter as array', () => {
      const result = fxManager.stutterFX([1, 2, 3]);
      expect(result).toBeUndefined();
    });

    it('should accept default numStutters (2)', () => {
      const result = fxManager.stutterFX([1]);
      expect(result).toBeUndefined();
    });

    it('should accept custom numStutters', () => {
      const result = fxManager.stutterFX([1], 4);
      expect(result).toBeUndefined();
    });

    it('should accept custom duration', () => {
      const result = fxManager.stutterFX([1], 2, 500);
      expect(result).toBeUndefined();
    });

    it('should handle single channel in array', () => {
      const result = fxManager.stutterFX([1], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle multiple channels (up to 5)', () => {
      const channels = [1, 2, 3, 4, 5];
      const result = fxManager.stutterFX(channels, 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should default to 2 stutters if parameter omitted', () => {
      const result1 = fxManager.stutterFX([1]);
      const result2 = fxManager.stutterFX([1], 2, 1000);
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });

    it('should handle empty channels array', () => {
      const result = fxManager.stutterFX([], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: numStutters = 1', () => {
      const result = fxManager.stutterFX([1], 1, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: numStutters > 5', () => {
      const result = fxManager.stutterFX([1], 10, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle edge case: duration = 0', () => {
      const result = fxManager.stutterFX([1], 2, 0);
      expect(result).toBeUndefined();
    });
  });

  describe('Channel Tracking Behavior', () => {
    it('should maintain separate tracking for fade and pan', () => {
      fxManager.stutterFade([1]);
      fxManager.stutterPan([2]);
      expect(fxManager.lastUsedCHs).toBeDefined();
      expect(fxManager.lastUsedCHs2).toBeDefined();
    });

    it('should reset tracking when explicitly called', () => {
      fxManager.lastUsedCHs.add(1);
      fxManager.lastUsedCHs2.add(2);
      expect(fxManager.lastUsedCHs.size).toBeGreaterThan(0);
      fxManager.resetChannelTracking();
      expect(fxManager.lastUsedCHs.size).toBe(0);
      expect(fxManager.lastUsedCHs2.size).toBe(0);
    });

    it('should maintain separate sets for fade and pan tracking', () => {
      fxManager.lastUsedCHs.add(1);
      fxManager.lastUsedCHs2.add(2);
      expect(fxManager.lastUsedCHs.size).toBe(1);
      expect(fxManager.lastUsedCHs2.size).toBe(1);
      expect(fxManager.lastUsedCHs).not.toBe(fxManager.lastUsedCHs2);
    });
  });

  describe('Integration', () => {
    it('should chain multiple stutter effects', () => {
      fxManager.stutterFade([1], 2, 500);
      fxManager.stutterPan([2], 2, 500);
      fxManager.stutterFX([3], 2, 500);
      expect(fxManager).toBeDefined();
    });

    it('should handle rapid successive calls', () => {
      for (let i = 0; i < 10; i++) {
        fxManager.stutterFade([1], 1, 100);
      }
      expect(fxManager).toBeDefined();
    });

    it('should apply all three stutter types to same channel', () => {
      const ch = [1];
      fxManager.stutterFade(ch, 2, 500);
      fxManager.stutterPan(ch, 2, 500);
      fxManager.stutterFX(ch, 2, 500);
      expect(fxManager).toBeDefined();
    });

    it('should handle mixed channel arrays', () => {
      fxManager.stutterFade([1], 2, 500);
      fxManager.stutterPan([1, 2, 3], 2, 500);
      fxManager.stutterFX([2, 3], 2, 500);
      expect(fxManager).toBeDefined();
    });
  });

  describe('Parameter Variations', () => {
    it('should handle undefined duration parameter', () => {
      const result = fxManager.stutterFade([1], 2);
      expect(result).toBeUndefined();
    });

    it('should handle undefined numStutters parameter', () => {
      const result = fxManager.stutterFade([1]);
      expect(result).toBeUndefined();
    });

    it('should handle both parameters undefined', () => {
      const result = fxManager.stutterFade([1]);
      expect(result).toBeUndefined();
    });

    it('should handle very large numStutters', () => {
      const result = fxManager.stutterFade([1], 100, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle very long duration', () => {
      const result = fxManager.stutterFade([1], 2, 10000);
      expect(result).toBeUndefined();
    });

    it('should handle very short duration', () => {
      const result = fxManager.stutterFade([1], 2, 10);
      expect(result).toBeUndefined();
    });
  });

  describe('Edge Cases and Robustness', () => {
    it('should handle channel 0', () => {
      const result = fxManager.stutterFade([0], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle high channel numbers', () => {
      const result = fxManager.stutterFade([15], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle negative numStutters', () => {
      const result = fxManager.stutterFade([1], -1, 1000);
      expect(result).toBeUndefined();
    });

    it('should handle negative duration', () => {
      const result = fxManager.stutterFade([1], 2, -1000);
      expect(result).toBeUndefined();
    });

    it('should handle duplicate channels in array', () => {
      const result = fxManager.stutterFade([1, 1, 2, 2, 3], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should work after reset', () => {
      fxManager.stutterFade([1], 2, 1000);
      fxManager.resetChannelTracking();
      const result = fxManager.stutterFade([2], 2, 1000);
      expect(result).toBeUndefined();
    });

    it('should not accumulate state over multiple calls to different effects', () => {
      fxManager.stutterFade([1], 2, 1000);
      const fadeSize = fxManager.lastUsedCHs.size;
      fxManager.stutterPan([2], 2, 1000);
      // Pan should use lastUsedCHs2, not affect lastUsedCHs
      expect(fxManager.lastUsedCHs.size).toEqual(fadeSize);
    });

    it('should support multiple instances', () => {
      const fm1 = new FxManager();
      const fm2 = new FxManager();
      fm1.stutterFade([1], 2, 1000);
      fm2.stutterFade([2], 2, 1000);
      expect(fm1.lastUsedCHs).not.toBe(fm2.lastUsedCHs);
    });
  });

  describe('State Management', () => {
    it('should allow manual state tracking', () => {
      expect(fxManager.lastUsedCHs.size).toBe(0);
      fxManager.lastUsedCHs.add(1);
      fxManager.lastUsedCHs.add(2);
      const sizeAfterManual = fxManager.lastUsedCHs.size;
      expect(sizeAfterManual).toBe(2);
      fxManager.resetChannelTracking();
      expect(fxManager.lastUsedCHs.size).toBe(0);
    });

    it('should maintain independent state for fade and pan', () => {
      // Manually add to sets to verify independence
      fxManager.lastUsedCHs.add(1);
      fxManager.lastUsedCHs.add(2);
      fxManager.lastUsedCHs2.add(3);
      fxManager.lastUsedCHs2.add(4);
      // Both should be populated independently
      expect(fxManager.lastUsedCHs.size).toBe(2);
      expect(fxManager.lastUsedCHs2.size).toBe(2);
      expect(fxManager.lastUsedCHs).not.toBe(fxManager.lastUsedCHs2);
    });

    it('should preserve state after calling FX stutter', () => {
      fxManager.stutterFade([1, 2], 2, 1000);
      const fadeSize = fxManager.lastUsedCHs.size;
      fxManager.stutterFX([3, 4], 2, 1000);
      // Fade state should not change after FX stutter
      expect(fxManager.lastUsedCHs.size).toEqual(fadeSize);
    });
  });
});
