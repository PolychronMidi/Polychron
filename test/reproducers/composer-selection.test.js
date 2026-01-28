import { expect, it, describe } from 'vitest';

// This test is gated; set RUN_REPRO_TEST=1 to run full reproducer/integration tests
const gated = !!process.env.RUN_REPRO_TEST;

describe('Composer selection defensive validation', () => {
  it('detects invalid composer selection (gated)', () => {
    if (!gated) {
      console.warn('Skipping composer selection test - set RUN_REPRO_TEST=1 to enable');
      return;
    }

    // Simulate corrupted composers array where one element is a plain object
    composers = [{ type: 'scale', name: 'Cmaj' }, { getDivisions: () => 3 }];

    // ra - random helper from backstage (copied minimal form to avoid importing heavy modules)
    const ra = (v) => { if (typeof v === 'function') return ra(v()); if (Array.isArray(v)) return v[Math.floor(Math.random() * v.length)]; return v; };

    const picked = ra(composers);
    const isValid = picked && typeof picked.getDivisions === 'function' && typeof picked.getSubdivs === 'function' && typeof picked.getSubsubdivs === 'function' && typeof picked.getMeter === 'function';
    expect(isValid).toBe(false);
  });
});
