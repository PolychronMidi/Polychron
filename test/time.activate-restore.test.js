import { describe, it, expect, beforeEach } from 'vitest';

// Ensure layer activation properly restores the layer's meter (numerator/denominator)
// so we do not end up with a mismatched numerator that causes boundary violations.

describe('LM.activate meter restoration', () => {
  beforeEach(() => {
    // Load runtime modules so LM.register/activate are available
    require('../src/writer.js'); require('../src/time.js'); require('../src/rhythm.js');
    // reset any existing layer state
    if (LM && LM.layers) LM.layers = {};
  });

  it('restores primary meter after poly activation', () => {
    // Set primary meter, register primary layer, and activate primary
    numerator = 4; denominator = 4; measuresPerPhrase = 1;
    const { state: primary } = LM.register('primary', 'c1', {});
    LM.activate('primary', false);

    // Primary's state should now contain the primary meter
    expect(primary.numerator).toBe(4);
    expect(primary.denominator).toBe(4);

    // Simulate poly override: set polyNumerator and activate poly
    polyNumerator = 5; polyDenominator = 4;
    LM.register('poly', 'c2', {});
    LM.activate('poly', true);
    // After poly activation, global numerator should reflect poly
    expect(numerator).toBe(5);

    // Now activate primary again; globals should be restored to primary values
    LM.activate('primary', false);
    expect(numerator).toBe(4);
    expect(denominator).toBe(4);
  });
});
