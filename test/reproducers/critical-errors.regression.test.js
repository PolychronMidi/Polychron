import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('Critical errors regression', () => {
  it('play run produces no critical-errors.ndjson (gated)', () => {
    if (!process.env.RUN_REPRO_TEST) {
      console.warn('Skipping critical-errors regression test - set RUN_REPRO_TEST=1 to enable');
      return;
    }

    // Clean up previous artifacts
    const out = path.join(process.cwd(), 'output', 'critical-errors.ndjson');
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (e) { /* swallow */ }

    // Run a short play to exercise timing and composer getters
    const env = Object.assign({}, process.env, { PLAY_LIMIT: '1' });
    try {
      const { SHORT_CHILD_PROC_TIMEOUT } = require('../test-timeouts');
      execSync('node scripts/play-guard.js', { env, stdio: 'inherit', timeout: SHORT_CHILD_PROC_TIMEOUT });
    } catch (e) {
      // Play is expected to exit non-zero when a real critical condition is present
    }

    // Assert no critical entries were produced
    const hasCritical = fs.existsSync(out) && fs.readFileSync(out, 'utf8').trim().length > 0;
    expect(hasCritical).toBe(false);
  });
});
