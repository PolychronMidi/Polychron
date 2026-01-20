import { describe, it, expect } from 'vitest';
import { attachToGlobalVenue, detachFromGlobalVenue } from '../src/venue';

describe('venue migration helpers', () => {
  it('detach and attach Venue API', () => {
    attachToGlobalVenue();
    expect((globalThis as any).getMidiValue).toBeDefined();
    detachFromGlobalVenue();
    expect((globalThis as any).getMidiValue).toBeUndefined();
    attachToGlobalVenue();
  });
});
