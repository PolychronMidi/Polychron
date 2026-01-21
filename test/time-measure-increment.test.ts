import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers.module.js';
import { setUnitTiming } from '../src/time.js';
import { registerWriterServices, CSVBuffer } from '../src/writer.js';

describe('Timing increments', () => {
  it('measureStart should advance by tpMeasure when measureIndex increases', () => {
    const ctx = createTestContext();
    const g = globalThis as any;

    // Ensure writer services and buffer available for DI-only operations
    registerWriterServices(ctx.services);
    ctx.csvBuffer = ctx.csvBuffer || new CSVBuffer('test');

    // Set deterministic values
    ctx.state.tpMeasure = 1000;
    ctx.state.phraseStart = 0;

    // Start at measure 0 (use context state instead of global)
    ctx.state.measureIndex = 0;
    setUnitTiming('measure', ctx);
    const ms0 = ctx.state.measureStart;

    // Next measure
    ctx.state.measureIndex = 1;
    setUnitTiming('measure', ctx);
    const ms1 = ctx.state.measureStart;

    expect(ms1 - ms0).toBeGreaterThanOrEqual(1000);
  });
});
