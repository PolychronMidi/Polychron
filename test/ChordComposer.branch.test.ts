import { describe, it, expect, beforeEach } from 'vitest';
import { ChordComposer, RandomChordComposer } from '../src/composers/ChordComposer';

describe('ChordComposer - branch tests', () => {
  beforeEach(() => {
    // minimal global t API
    (globalThis as any).t = {
      Chord: {
        get: (name: string) => ({ notes: ['C', 'E', 'G'], tonic: 'C' })
      },
      Note: {
        chroma: (n: string) => 60
      }
    };
    (globalThis as any).ri = (a: number, b?: number) => 0;
    (globalThis as any).allChords = ['Cmaj', 'Dmaj'];

    // Minimal global composer constants used by MeasureComposer
    (globalThis as any).VOICES = { min: 1, max: 3, weights: [1,1,1] };
    (globalThis as any).OCTAVE = { min: 3, max: 5, weights: [1,1,1] };
    (globalThis as any).NUMERATOR = { min: 2, max: 8, weights: [1,1,1,1,1,1,1] };
    (globalThis as any).DENOMINATOR = { min: 2, max: 8, weights: [1,1,1,1,1,1,1] };
    (globalThis as any).DIVISIONS = { min: 1, max: 4, weights: [1,1,1,1] };
    (globalThis as any).SUBDIVISIONS = { min: 1, max: 4, weights: [1,1,1,1] };
    (globalThis as any).SUBSUBDIVS = { min: 0, max: 2, weights: [1,1,1] };

    // Simple random utilities
    (globalThis as any).rf = () => 0.5;
    (globalThis as any).rv = (a: any) => a;
    (globalThis as any).rw = (min: number) => min; // simplified weighted random
    (globalThis as any).m = { floor: Math.floor, abs: Math.abs, round: Math.round, max: Math.max };
  });

  it('initializes with a progression and exposes progression and root', () => {
    const c = new ChordComposer(['C', 'D']);
    expect(c.progression && c.progression.length).toBeGreaterThan(0);
    expect(typeof c.root).toBe('string');
    expect(Array.isArray(c.notes)).toBe(true);
  });

  it('RandomChordComposer regenerates progression', () => {
    const r = new RandomChordComposer();
    expect(r.progression && r.progression.length).toBeGreaterThanOrEqual(1);
    r.regenerateProgression();
    expect(r.progression && r.progression.length).toBeGreaterThanOrEqual(1);
  });
});
