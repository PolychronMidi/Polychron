import { describe, it, expect } from 'vitest';
import { attachToGlobalTime, detachFromGlobalTime } from '../src/time';

describe('time migration helpers', () => {
  it('detach and attach Time API', () => {
    attachToGlobalTime();
    expect((globalThis as any).TimingCalculator).toBeDefined();
    detachFromGlobalTime();
    expect((globalThis as any).TimingCalculator).toBeUndefined();
    attachToGlobalTime();
  });
});
