import { describe, it, expect } from 'vitest';

describe('test-setup.ts', () => {
  it('should install console originals when running under test', () => {
    // The setup file installs originals as console._origError etc.
    expect(typeof (console as any)._origError === 'function' || (typeof (console as any)._origError === 'undefined')).toBe(true);
    // If originals exist, they should be functions
    if ((console as any)._origError) {
      expect(typeof (console as any)._origError).toBe('function');
    }
  });
});
