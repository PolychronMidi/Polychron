import { test, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Ensure a short play run completes without throwing unexpected CRITICAL errors.
// This guards against intermittent crashes that were observed in CI logs.

test('short play run should exit 0 and emit no critical errors', async () => {
  const script = path.join(process.cwd(), 'scripts', 'play-guard.js');
  // Clear diagnostics files before run
  try { fs.unlinkSync(path.join(process.cwd(), 'output', 'critical-errors.ndjson')); } catch (e) { /* swallow */ }

  // Retry loop: if play-guard reports an existing play, wait briefly and retry.
  const MAX_RETRIES = 20;
  let res;
  const runStart = new Date().toISOString();
  // Assign a unique play run id so we can filter CRITICALs belonging only to this run
  const playRunId = `short-run-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    res = spawnSync(process.execPath, [script], { env: { ...process.env, PLAY_LIMIT: '1', PLAY_RUN_ID: playRunId }, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const stderr = String(res.stderr || '');
    if (stderr.includes('Waiting until it finishes')) {
      await new Promise(r => setTimeout(r, 250));
      continue;
    }
    break;
  }

  // If the process exited non-zero, include stdout/stderr in the assertion error for debugging
  if (res.status !== 0) {
    // Collect recent critical log lines if present
    let crit = null;
    try { crit = fs.readFileSync(path.join(process.cwd(), 'output', 'critical-errors.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).slice(-50).join('\n'); } catch (e) { crit = null; }
    const msg = `play.js failed (status=${res.status}) stdout:\n${res.stdout}\nstderr:\n${res.stderr}\nrecent-critical:\n${crit}`;
    throw new Error(msg);
  }

  // If the process exited 0, ensure critical-errors file has no new critical entries (only consider entries emitted during our run)
  const { checkCriticalsSince } = require('../scripts/play-guard-check');
  const recent = checkCriticalsSince(runStart, undefined, playRunId);
  if (recent && recent.length) {
    throw new Error(`Found CRITICAL entries emitted during short play run:\n${recent.map(r => JSON.stringify(r)).join('\n')}`);
  }

  expect(res.status).toBe(0);
});
