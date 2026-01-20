import { describe, it, expect } from 'vitest';
import { validateConfig, setConfig, resetConfig, getConfig, DEFAULT_CONFIG } from '../src/PolychronConfig';

describe('PolychronConfig - branch tests', () => {
  it('validateConfig returns errors for an invalid config', () => {
    const invalid = { ...DEFAULT_CONFIG } as any;
    invalid.ppq = 10; // too small
    invalid.bpm = 10; // too small
    invalid.binaural = { min: 50, max: 10 }; // invalid range
    invalid.numerator = { min: 2, max: 3, weights: [1] }; // mismatch weights length

    const errors = validateConfig(invalid);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some(e => e.includes('ppq'))).toBe(true);
    expect(errors.some(e => e.includes('bpm'))).toBe(true);
    expect(errors.some(e => e.includes('binaural'))).toBe(true);
  });

  it('setConfig throws on invalid config', () => {
    const bad = { ...DEFAULT_CONFIG } as any;
    bad.ppq = -1;
    expect(() => setConfig(bad)).toThrow();
  });

  it('resetConfig and getConfig work', () => {
    // reset to defaults and verify
    resetConfig();
    const current = getConfig();
    expect(current.bpm).toBe(DEFAULT_CONFIG.bpm);
  });
});
