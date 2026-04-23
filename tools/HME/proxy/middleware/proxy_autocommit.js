'use strict';
// proxy_autocommit.js — timer-driven autocommit inside the proxy event loop.
//
// History of failure modes that led here:
//   1. userpromptsubmit hook (extension → _proxy_bridge.sh): drops silently
//      in VS Code Claude extension mode. Repeated incidents.
//   2. proxy onRequest middleware (initial design here): only fires when the
//      extension routes /v1/messages through 127.0.0.1:9099. Evidence shows
//      it does NOT — the extension uses the proxy for /hme/lifecycle hook
//      calls but bypasses it for actual API requests. So request-triggered
//      middleware never fires.
//
// Solution: don't depend on incoming traffic at all. The proxy process is
// supervised and always running. setInterval inside this module's load path
// gives us a tick that runs as long as the proxy is up. Every HME_AUTOCOMMIT_
// INTERVAL_MS milliseconds (default 10s), poll git status; commit anything
// dirty; route failures to hme-errors.log.
//
// Self-cleaning: the timer is detached at module load. No PID file, no side-
// channel state. The supervisor restarts the proxy if it dies; the timer
// re-registers on next module load.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ERR_LOG = 'log/hme-errors.log';
const INTERVAL_MS = parseInt(process.env.HME_AUTOCOMMIT_INTERVAL_MS, 10) || 10000;

// Resolve PROJECT_ROOT once at load time. ctx.PROJECT_ROOT is only available
// in onRequest, but the timer runs without ctx, so use the env var.
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR;

function _appendErr(msg) {
  if (!PROJECT_ROOT) return;
  try {
    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    fs.appendFileSync(path.join(PROJECT_ROOT, ERR_LOG), `[${ts}] [autocommit:proxy-timer] ${msg}\n`);
  } catch (_e) { /* best-effort */ }
}

function _tick() {
  if (!PROJECT_ROOT) return;
  if (!fs.existsSync(path.join(PROJECT_ROOT, '.git'))) return;
  let dirty = '';
  try {
    dirty = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 3000 });
  } catch (err) {
    _appendErr(`git status failed: ${err.message.slice(0, 200)}`);
    return;
  }
  if (!dirty.trim()) return;
  const ts = new Date().toISOString().slice(0, 19);
  try {
    execSync('git add -A', { cwd: PROJECT_ROOT, timeout: 5000 });
  } catch (err) {
    _appendErr(`git add failed: ${err.message.slice(0, 200)}`);
    return;
  }
  try {
    execSync(`git commit -m "${ts}" --quiet`, { cwd: PROJECT_ROOT, timeout: 5000 });
  } catch (err) {
    const msg = (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : '');
    if (msg.includes('nothing to commit')) return;
    _appendErr(`git commit failed: ${(msg || err.message).slice(0, 300)}`);
  }
}

// First tick immediately at module load so dirty state at proxy startup
// gets committed without waiting for the first interval. Then start the
// regular polling loop.
if (PROJECT_ROOT) {
  setImmediate(_tick);
  const handle = setInterval(_tick, INTERVAL_MS);
  // Detach so this timer doesn't keep the proxy event loop alive past
  // its other cleanup. Proxy lifecycle owns the process; timer is a
  // passenger.
  if (handle && typeof handle.unref === 'function') handle.unref();
}

// Keep the onRequest export as a no-op so the middleware loader sees a
// valid module. The actual work is in the timer above.
module.exports = {
  name: 'proxy_autocommit',
  onRequest() { /* no-op — timer-driven; see top-of-file rationale */ },
};
