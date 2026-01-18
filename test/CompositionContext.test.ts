import { describe, it, expect } from 'vitest';
import type { CompositionContext } from '../src/CompositionContext';

describe('CompositionContext', () => {
  it('should define expected properties', () => {
    const context: Partial<CompositionContext> = {
      currentMeasure: 1,
      totalMeasures: 4,
      currentBeat: 0,
      currentSection: 'intro',
    };

    expect(context.currentMeasure).toBe(1);
    expect(context.totalMeasures).toBe(4);
    expect(context.currentBeat).toBe(0);
    expect(context.currentSection).toBe('intro');
  });

  it('should allow optional properties', () => {
    const context: Partial<CompositionContext> = {
      currentMeasure: 2,
    };

    expect(context.currentMeasure).toBe(2);
    expect(context.totalMeasures).toBeUndefined();
  });

  it('should support all context properties', () => {
    const context: Partial<CompositionContext> = {
      currentMeasure: 3,
      totalMeasures: 8,
      currentBeat: 2,
      currentSection: 'verse',
      tempo: 120,
    };

    expect(typeof context.currentMeasure).toBe('number');
    expect(typeof context.currentSection).toBe('string');
  });
});
