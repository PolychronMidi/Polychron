import { describe, it, expect } from 'vitest';
import { attachToGlobal, detachFromGlobal } from '../src/writer';

describe('writer migration helpers', () => {
  it('detach and attach global writer API', () => {
    // Ensure functions exist and can be detached/attached
    attachToGlobal();
    expect((globalThis as any).p).toBeDefined();
    detachFromGlobal();
    expect((globalThis as any).p).toBeUndefined();
    attachToGlobal();
    expect((globalThis as any).p).toBeDefined();
  });
});
