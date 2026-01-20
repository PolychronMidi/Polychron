import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressionGenerator } from '../src/composers/ProgressionGenerator';

describe('ProgressionGenerator - branch tests', () => {
  beforeEach(() => {
    (globalThis as any).t = {
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
    };
    (globalThis as any).ri = () => 0;
  });

  it('generates I-IV-V progression in major key', () => {
    const pg = new ProgressionGenerator('C', 'major');
    const arr = pg.generate('I-IV-V');
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0]).toContain('C');
  });

  it('romanToChord returns null for invalid input', () => {
    const pg = new ProgressionGenerator('C', 'major');
    expect(pg.romanToChord('Z')).toBeNull();
  });
});
