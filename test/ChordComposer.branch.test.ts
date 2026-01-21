import { describe, it, expect, beforeEach } from 'vitest';
import { ChordComposer, RandomChordComposer } from '../src/composers/ChordComposer';

describe('ChordComposer - branch tests', () => {
  let deps: any;

  beforeEach(() => {
    // minimal t API and utilities injected via deps (no globals)
    deps = {
      t: {
        Chord: {
          get: (name: string) => ({ notes: ['C', 'E', 'G'], tonic: 'C' })
        },
        Note: {
          chroma: (n: string) => 60
        }
      },
      ri: (a: number, b?: number) => 0,
      allChords: ['Cmaj', 'Dmaj'],
      m: { floor: Math.floor, abs: Math.abs, round: Math.round, max: Math.max }
    };
  });

  it('initializes with a progression and exposes progression and root', () => {
    const c = new ChordComposer(['C', 'D'], deps);
    expect(c.progression && c.progression.length).toBeGreaterThan(0);
    expect(typeof c.root).toBe('string');
    expect(Array.isArray(c.notes)).toBe(true);
  });

  it('RandomChordComposer regenerates progression', () => {
    const r = new RandomChordComposer(deps);
    expect(r.progression && r.progression.length).toBeGreaterThanOrEqual(1);
    r.regenerateProgression();
    expect(r.progression && r.progression.length).toBeGreaterThanOrEqual(1);
  });
});
