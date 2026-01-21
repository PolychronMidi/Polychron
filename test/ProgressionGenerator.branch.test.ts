import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressionGenerator } from '../src/composers/ProgressionGenerator';

describe('ProgressionGenerator - branch tests', () => {
  beforeEach(() => {
    const deps = {
      t: {
        Scale: { get: (k: string) => ({}) },
        Key: {
          majorKey: (k: string) => ({ scale: ['C','D','E','F','G','A','B'], chords: ['Cmaj','Dmin','Emin','Fmaj','Gmaj','Amin','Bdim'] }),
          minorKey: (k: string) => ({ natural: { scale: ['A','B','C'], chords: [] } })
        },
        Note: {
          chroma: (n: string) => 60,
          fromMidi: (m: number) => m,
          pitchClass: (m: number) => 'C'
        }
      },
      ri: () => 0
    };
    (globalThis as any)._TEST_DEPS = deps;
  });

  it('generates I-IV-V progression in major key', () => {
    const deps = (globalThis as any)._TEST_DEPS;
    const pg = new ProgressionGenerator('C', 'major', deps);
    const arr = pg.generate('I-IV-V');
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0]).toContain('C');
  });

  it('romanToChord returns null for invalid input', () => {
    const deps = (globalThis as any)._TEST_DEPS;
    const pg = new ProgressionGenerator('C', 'major', deps);
    expect(pg.romanToChord('Z')).toBeNull();
  });
});
