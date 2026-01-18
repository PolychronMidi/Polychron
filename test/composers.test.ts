import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import side-effect module to populate global composers
import '../src/composers';

describe('composers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should populate global composer constructors', () => {
    expect(globalThis.ScaleComposer).toBeDefined();
    expect(globalThis.RandomScaleComposer).toBeDefined();
    expect(globalThis.ChordComposer).toBeDefined();
    expect(globalThis.RandomChordComposer).toBeDefined();
    expect(globalThis.ModeComposer).toBeDefined();
    expect(globalThis.RandomModeComposer).toBeDefined();
  });

  it('should have constructor functions', () => {
    expect(typeof globalThis.ScaleComposer).toBe('function');
    expect(typeof globalThis.MeasureComposer).toBe('function');
  });

  it('should allow instantiation of composers', () => {
    const scale = new (globalThis.ScaleComposer as any)('major', 'C');
    expect(scale).toBeDefined();
    expect(scale.notes).toBeDefined();
  });

  it('should register all expected composers', () => {
    const expectedComposers = [
      'MeasureComposer',
      'ScaleComposer',
      'RandomScaleComposer',
      'ChordComposer',
      'RandomChordComposer',
      'ModeComposer',
      'RandomModeComposer',
      'PentatonicComposer',
      'RandomPentatonicComposer',
    ];

    expectedComposers.forEach(composerName => {
      expect((globalThis as any)[composerName]).toBeDefined();
    });
  });
});
