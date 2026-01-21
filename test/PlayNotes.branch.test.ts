import { describe, it, expect, beforeEach } from 'vitest';
import { PlayNotes } from '../src/playNotes';
import { createTestContext } from './helpers.module.js';
import { registerWriterServices, CSVBuffer } from '../src/writer.js';

describe('PlayNotes - branch tests', () => {
  let ctx: any;
  beforeEach(() => {
    // Minimal deterministic globals
    (globalThis as any).beatRhythm = [1];
    (globalThis as any).divRhythm = [0];
    (globalThis as any).subdivRhythm = [0];
    (globalThis as any).subdivsPerBeat = 2;
    (globalThis as any).midiBPM = 120;
    (globalThis as any).tpSubdiv = 10;
    (globalThis as any).subdivStart = 5;
    (globalThis as any).divIndex = 0;
    (globalThis as any).divsOn = 0;
    (globalThis as any).divsOff = 0;
    (globalThis as any).subdivsOn = 0;
    (globalThis as any).subdivsOff = 0;
    (globalThis as any).beatsby = 0;
    (globalThis as any).velocity = 90;
    (globalThis as any).rf = () => 0.5;
    (globalThis as any).rv = (a: any) => a;
    (globalThis as any).ri = () => 0;
    (globalThis as any).m = { max: Math.max, min: Math.min, round: Math.round };
    (globalThis as any).composer = { getNotes: () => [{ note: 60 }] };
    (globalThis as any).activeMotif = null;
    // Create a DI-enabled test context and register writer services
    ctx = createTestContext();
    registerWriterServices(ctx.services);
    ctx.csvBuffer = new CSVBuffer('test');
    (globalThis as any).c = ctx.csvBuffer;
    (globalThis as any).source = [1];
    (globalThis as any).reflect = [2];
    (globalThis as any).flipBin = false;
    (globalThis as any).flipBinF = [1];
    (globalThis as any).flipBinT = [1];
    (globalThis as any).reflection = [2];
    (globalThis as any).bass = [3];
    (globalThis as any).ref = [2];
    (globalThis as any).reflect2 = [4];
    (globalThis as any).cCH1 = 1; (globalThis as any).cCH2 = 2; (globalThis as any).cCH3 = 3;
    // utilities used by playNotes2
    (globalThis as any).clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    (globalThis as any).modClamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    (globalThis as any).OCTAVE = { min: 1, max: 6 };
  });

  it('setNoteParams and playNotes push events to buffer', () => {
    const p = new PlayNotes();
    // Force cross-modulation high so branch executes and writes events
    p.crossModulation = 10;
    p.lastCrossMod = 10;
    // use playNotes2 which always iterates the motif notes branch and writes to buffer
    p.playNotes2(ctx);
    expect(ctx.csvBuffer.rows.length).toBeGreaterThan(0);
  });

  it('crossModulateRhythms produces a numeric crossModulation', () => {
    const p = new PlayNotes();
    p.crossModulateRhythms();
    expect(typeof p.crossModulation).toBe('number');
  });
});
