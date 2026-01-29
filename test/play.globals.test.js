import { it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

it('play should preserve naked globals visible to LM.activate/advance', async () => {
  const script = path.join(process.cwd(), 'scripts', 'run-globals-check.js');
  let res;
  // Retry loop: if play-guard reports an existing play, wait briefly and retry.
  // This avoids flakiness when other tests run concurrent plays and hold the lock.
  const MAX_RETRIES = 30;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const envAttempt = { ...process.env, PLAY_LIMIT: '1', PLAY_GUARD_FAIL_ON_BUSY: '1' };
    // Use a per-attempt timeout to avoid a single play blocking the test harness indefinitely
    const { CHILD_PROC_TIMEOUT } = require('./test-timeouts');
    res = spawnSync(process.execPath, [script], { env: envAttempt, encoding: 'utf8', timeout: CHILD_PROC_TIMEOUT });
    const stderr = String(res.stderr || '');
    if (stderr.includes('Waiting until it finishes')) {
      // Busy: wait and retry
      await new Promise(r => setTimeout(r, 200));
      continue;
    }
    // If play-guard failed fast with code 5, treat as busy and retry a few more times
    if (res.status === 5) {
      await new Promise(r => setTimeout(r, 200));
      continue;
    }
    break;
  }
  expect(res && res.status === 0, `Expected script to exit 0, got ${res && res.status}`).toBe(true);

  const traces = path.join(process.cwd(), 'output', 'globals-check.ndjson');
  expect(fs.existsSync(traces)).toBe(true);
  const lines = fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  // We expect at least one after-activate entries and loop-division entries
  const recs = lines.map(l => JSON.parse(l));
  const hasAfterActivatePrimary = recs.some(r => r.tag === 'after-activate-primary' && r.layer === 'primary');
  const hasLoopDivisionPrimary = recs.some(r => r.tag === 'loop-division-primary' && r.layer === 'primary');

  expect(hasAfterActivatePrimary).toBe(true);
  expect(hasLoopDivisionPrimary).toBe(true);
  // Poly may not appear in PLAY_LIMIT=1 runs but we still ensure file format is valid
  expect(recs.length).toBeGreaterThan(0);
});
