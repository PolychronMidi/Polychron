import { describe, it, expect, vi, beforeEach } from 'vitest';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeasureComposer, ScaleComposer, RandomScaleComposer, ChordComposer, RandomChordComposer, ModeComposer, RandomModeComposer, PentatonicComposer, RandomPentatonicComposer } from '../src/composers.js';

describe('composers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should have composer constructors available as named exports', () => {
    expect(ScaleComposer).toBeDefined();
    expect(RandomScaleComposer).toBeDefined();
    expect(ChordComposer).toBeDefined();
    expect(RandomChordComposer).toBeDefined();
    expect(ModeComposer).toBeDefined();
    expect(RandomModeComposer).toBeDefined();
  });

  it('should have constructor functions', () => {
    expect(typeof ScaleComposer).toBe('function');
    expect(typeof MeasureComposer).toBe('function');
  });

  it('should allow instantiation of composers', () => {
    const scale = new ScaleComposer('major', 'C');
    expect(scale).toBeDefined();
    expect(scale.notes).toBeDefined();
  });

  it('should register all expected composers', () => {
    const composers = [
      MeasureComposer,
      ScaleComposer,
      RandomScaleComposer,
      ChordComposer,
      RandomChordComposer,
      ModeComposer,
      RandomModeComposer,
      PentatonicComposer,
      RandomPentatonicComposer,
    ];

    composers.forEach(c => {
      expect(c).toBeDefined();
    });
  });
});
