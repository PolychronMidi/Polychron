import { test, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Ensure a short play run completes without throwing unexpected CRITICAL errors.
// This guards against intermittent crashes that were observed in CI logs.

test('short play run should exit 0 and emit no critical errors', () => {
  const script = path.join(process.cwd(), 'src', 'play.js');
  // Clear diagnostics files before run
  try { fs.unlinkSync(path.join(process.cwd(), 'output', 'critical-errors.ndjson')); } catch (e) { /* swallow */ }
  // Run node in a child process with a short PLAY_LIMIT
  const res = spawnSync(process.execPath, [script], { env: { ...process.env, PLAY_LIMIT: '1' }, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  // If the process exited non-zero, include stdout/stderr in the assertion error for debugging
  if (res.status !== 0) {
    // Collect recent critical log lines if present
    let crit = null;
    try { crit = fs.readFileSync(path.join(process.cwd(), 'output', 'critical-errors.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).slice(-5).join('\n'); } catch (e) { crit = null; }
    const msg = `play.js failed (status=${res.status}) stdout:\n${res.stdout}\nstderr:\n${res.stderr}\nrecent-critical:\n${crit}`;
    throw new Error(msg);
  }

  // If the process exited 0, ensure critical-errors file has no new critical entries
  const critExists = fs.existsSync(path.join(process.cwd(), 'output', 'critical-errors.ndjson'));
  if (critExists) {
    const content = fs.readFileSync(path.join(process.cwd(), 'output', 'critical-errors.ndjson'), 'utf8');
    if (content && content.trim()) {
      // If there are CRITICAL entries, fail and show them
      throw new Error(`Found CRITICAL entries after short play run:\n${content.split(/\r?\n/).filter(Boolean).slice(-20).join('\n')}`);
    }
  }

  expect(res.status).toBe(0);
});
