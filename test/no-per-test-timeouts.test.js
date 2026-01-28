import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

// This test ensures no individual tests specify a numeric per-test timeout.
// We enforce that timeouts should be configured globally in vitest config only.

describe('test-suite style rules', () => {
  it('has no per-test numeric timeouts in repository tests', () => {
    const testsDir = path.join(process.cwd(), 'test');
    const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
    const offenders = [];
    const re = /(?:\b(?:it|test)\s*\([^,]+,\s*[\s\S]*?,\s*\d+\s*\))/m;
    for (const f of files) {
      const p = path.join(testsDir, f);
      const src = fs.readFileSync(p, 'utf8');
      if (re.test(src)) offenders.push(f);
    }
    if (offenders.length) {
      // Provide details for easy triage
      const msg = `Found per-test numeric timeouts in: ${offenders.join(', ')}.\n` +
        `Please remove per-test numeric timeouts and rely on global vitest timeout in configuration.`;
      console.error(msg);
    }
    expect(offenders.length).toBe(0);
  });
});
