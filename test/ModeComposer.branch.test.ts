import { describe, it, expect, beforeEach } from 'vitest';
import { ModeComposer, RandomModeComposer } from '../src/composers/ModeComposer';

describe('ModeComposer - branch tests', () => {
  beforeEach(() => {
    (globalThis as any).t = {
      Mode: { get: (k: string) => ({ notes: [60, 62, 64] }) },
      Scale: { get: (k: string) => ({ notes: [60, 62, 64] }) }
    };
    (globalThis as any).allModes = ['ionian'];
    (globalThis as any).allNotes = ['C'];
    (globalThis as any).ri = () => 0;
  });

  it('constructs and falls back to scale if needed', () => {
    const m = new ModeComposer('ionian', 'C');
    expect(m.notes && m.notes.length).toBeGreaterThan(0);
    const r = new RandomModeComposer();
    expect(r.notes && r.notes.length).toBeGreaterThan(0);
  });
});
