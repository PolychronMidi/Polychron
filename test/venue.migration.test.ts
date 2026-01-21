import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers';
import { registerVenueServices } from '../src/venue';

describe('venue migration (DI-first)', () => {
  it('registers venue services in DI and does not rely on globals', () => {
    const ctx = createTestContext();
    // Register venue services into DI container
    registerVenueServices(ctx.services);

    expect(ctx.services.has('getMidiValue')).toBe(true);
    expect(typeof ctx.services.get('getMidiValue')).toBe('function');

    // Legacy global getMidiValue should not be required
    expect((globalThis as any).getMidiValue).toBeUndefined();
  });
});
