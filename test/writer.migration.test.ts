import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers';

// DI-first: ensure writer services are registered and legacy globals are not relied upon
describe('writer migration (DI-first)', () => {
  it('registers writer services in DI and does not rely on globals', () => {
    const ctx = createTestContext();

    // Ensure DI contains expected writer services
    expect(ctx.services.has('pushMultiple')).toBe(true);
    expect(typeof ctx.services.get('pushMultiple')).toBe('function');
    expect(ctx.services.has('grandFinale')).toBe(true);
    expect(typeof ctx.services.get('grandFinale')).toBe('function');

    // Verify legacy global writer API is not required (should not be present)
    expect((globalThis as any).p).toBeUndefined();
  });
});
