import { describe, it, expect } from 'vitest';
import { CSVBuffer, pushMultiple } from '../src/writer.js';

describe('writer: drop unmatched off events', () => {
  it('drops a standalone off when no corresponding on exists', () => {
    const b = new CSVBuffer('test-drop-off');
    // Attempt to write an off event with no prior on
    pushMultiple(b, { tick: 0, type: 'off', vals: [0, 60] } as any);
    expect(b.rows.length).toBe(0);
    expect(((b as any)._activeNotes as Set<string>).has('0:60')).toBe(false);
  });

  it('accepts on then off for same channel+note', () => {
    const b = new CSVBuffer('test-on-off');
    pushMultiple(b, { tick: 0, type: 'on', vals: [1, 64, 100] } as any);
    pushMultiple(b, { tick: 10, type: 'off', vals: [1, 64] } as any);
    expect(b.rows.length).toBe(2);
    // After the off, active set should not contain the note
    expect(((b as any)._activeNotes as Set<string>).has('1:64')).toBe(false);
  });

  it('drops implicit off events (vals.length === 2) when unmatched', () => {
    const b = new CSVBuffer('test-implicit-off');
    pushMultiple(b, { tick: 5, vals: [2, 62] } as any); // implicit off
    expect(b.rows.length).toBe(0);
  });

  it('drops pre-off when on is later in batch (pre-off semantics)', () => {
    const b = new CSVBuffer('batch-pre-off');
    // off at tick 5 then on at tick 10 -> off should be dropped, on remains
    pushMultiple(b, { tick: 5, type: 'off', vals: [1, 60] } as any, { tick: 10, type: 'on', vals: [1, 60, 90] } as any);
    expect(b.rows.length).toBe(1);
    expect(b.rows[0].type).toBe('on');
  });

  it('accepts on then off in same batch when on is earlier', () => {
    const b = new CSVBuffer('batch-on-off');
    pushMultiple(b, { tick: 5, type: 'on', vals: [1, 61, 100] } as any, { tick: 10, type: 'off', vals: [1, 61] } as any);
    expect(b.rows.length).toBe(2);
    expect(b.rows[0].type).toBe('on');
    expect(b.rows[1].type).toBe('off');
  });
});
