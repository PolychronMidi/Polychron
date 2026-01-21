import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers.module.js';
import { registerTimeServices } from '../src/time';

describe('time migration (DI-first)', () => {
  it('registers timing services in DI and does not rely on globals', () => {
    const ctx = createTestContext();
    registerTimeServices(ctx.services);

    expect(ctx.services.has('TimingCalculator')).toBe(true);
    expect(typeof ctx.services.get('TimingCalculator')).toBe('function');

    // Legacy globals should not be required
    expect((globalThis as any).TimingCalculator).toBeUndefined();
  });
});
