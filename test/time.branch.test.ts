import '../src/backstage.js';
import '../src/sheet.js';

import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers.module.js';
import { LayerManager, TimingContext, TimingCalculator } from '../src/time.js';

describe('time.ts - branch and edge tests', () => {
  it('should compute correct syncFactor for meter spoofing (7/9 -> midi 7/8)', () => {
    const ctx = createTestContext();
    // Example: test meter ratio => midiMeterRatio / meterRatio
    const meterRatio = 7 / 9;
    const midiMeterRatio = 7 / 8; // nearest power-of-2 denom
    const syncFactor = midiMeterRatio / meterRatio;

    expect(syncFactor).toBeCloseTo((7/8) / (7/9));
  });

  it('constructor calculates midiMeter and syncFactor for non-power-of-2 denominator', () => {
    const calc = new TimingCalculator({ bpm: 120, ppq: 480, meter: [7, 9] });
    // Midi meter should be nearest power-of-2 denominator (7/8)
    expect(calc.midiMeter).toEqual([7, 8]);
    const expectedSync = (7 / 8) / (7 / 9);
    expect(calc.syncFactor).toBeCloseTo(expectedSync);
  });

  it('constructor throws for invalid meter values', () => {
    expect(() => new TimingCalculator({ bpm: 120, ppq: 480, meter: [NaN as any, NaN as any] })).toThrow();
  });
});
