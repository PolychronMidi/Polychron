const fs = require('fs'); const path = require('path'); const traces = path.join(process.cwd(), 'output', 'globals-check.ndjson'); try { if (fs.existsSync(traces)) fs.unlinkSync(traces); } catch (e) { /* swallow */ }
const { spawnSync } = require('child_process');
const playPath = path.join(process.cwd(), 'scripts', 'play-guard.js');
const env = Object.assign({}, process.env, { CHECK_GLOBALS: '1', ENABLE_LOGS: '1', DEBUG_TRACES: '1', INDEX_TRACES: '1', PLAY_LIMIT: process.env.PLAY_LIMIT || '1', PLAY_GUARD_FAIL_ON_BUSY: '1' });
let lines = [];
// Preflight cleanup: attempt to clear stale play locks to avoid hung/overlapping plays
try {
  const resClear = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'clear-stale-play-locks.js')], { env: Object.assign({}, process.env, { PLAY_GUARD_STALE_MS: process.env.PLAY_GUARD_STALE_MS || '30000' }), stdio: 'inherit' });
  if (resClear && resClear.status && resClear.status !== 0 && resClear.status !== 2 && resClear.status !== 3) {
    console.warn('run-globals-check: clear-stale-play-locks returned non-zero status', resClear.status);
  }
} catch (e) { /* swallow */ }

// Retry loop to handle transient concurrent play instances
for (let attempt = 0; attempt < 6; attempt++) {
  try { if (fs.existsSync(traces)) fs.unlinkSync(traces); } catch (e) { /* swallow */ }
  const res = spawnSync(process.execPath, [playPath], { env, stdio: 'inherit' });
  if (res.error) { console.error('play process execution failed', res.error); continue; }
  if (res.status !== 0) {
    // If play exited non-zero, try again - it may have collided with another play
    continue;
  }
  lines = fs.existsSync(traces) ? fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
  // If no lines were captured immediately (race with concurrent plays), poll briefly
  if (lines.length === 0) {
    const start = Date.now();
    const timeout = 10 * 1000; // 10s
    const interval = 200;
    while ((Date.now() - start) < timeout) {
      try { if (fs.existsSync(traces)) { lines = fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean); } } catch (e) { /* swallow */ }
      if (lines.length) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, interval);
    }
  }
  if (lines.length) break;
  // small backoff before next attempt
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
}
console.log('globals-check-lines', lines.length);
process.exit(0);
