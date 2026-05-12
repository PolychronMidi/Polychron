'use strict';
// Lifecycle bridge: two delivery paths for Claude Code hooks
// (SessionStart/UserPromptSubmit/Stop):
//   1. Forwarder POST to /hme/lifecycle?event=... (handleLifecycleRoute).
//   2. Inline fallback (runInlineFallback) when forwarder not reaching us.
// _lifecycleSeen + _LIFECYCLE_FRESH_MS=30s dedup window prevents double-fire.
// SessionStart fires inline at module load as a bare safety net.

const fs = require('fs');
const path = require('path');
const hookBridge = require('./hook_bridge');
const { PROJECT_ROOT } = require('./shared');

const _lifecycleSeen = { SessionStart: 0, UserPromptSubmit: 0, Stop: 0 };
const _LIFECYCLE_FRESH_MS = 30_000;

// Persist across restarts. Without this, every proxy restart resets the
// dedup timestamps -- if Claude Code's forwarder fired a /hme/lifecycle
// hit 5s before the restart, the new process thinks the forwarder has
// been silent for >30s and inline-fires the same event, double-running
// it. Persistence with TTL semantics avoids this. The file is small (3
// timestamps) and best-effort -- a write failure leaves us in the
// pre-fix behavior, not worse.
const _LIFECYCLE_STATE_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-lifecycle-seen.json');

function _loadLifecycleSeen() {
  try {
    const raw = fs.readFileSync(_LIFECYCLE_STATE_FILE, 'utf8');
    const s = JSON.parse(raw);
    for (const k of Object.keys(_lifecycleSeen)) {
      if (typeof s[k] === 'number') _lifecycleSeen[k] = s[k];
    }
  } catch (_e) { /* first boot or unreadable -- normal */ }
}

function _persistLifecycleSeen() {
  try {
    fs.mkdirSync(path.dirname(_LIFECYCLE_STATE_FILE), { recursive: true });
    fs.writeFileSync(_LIFECYCLE_STATE_FILE, JSON.stringify(_lifecycleSeen));
  } catch (_e) { /* best effort */ }
}

_loadLifecycleSeen();

function recordLifecycleHit(event) {
  _lifecycleSeen[event] = Date.now();
  _persistLifecycleSeen();
}

function lifecycleInactive(event) {
  const last = _lifecycleSeen[event] || 0;
  return (Date.now() - last) > _LIFECYCLE_FRESH_MS;
}

/**
 * Run an inline fallback dispatch and echo any captured stderr to the
 * proxy's own stderr so the user sees hook banners (sessionstart
 * orientation, LIFESAVER, etc.). Without this the stderr is silently
 * swallowed into dispatchEvent's return value and lost.
 *
 * Parity with /hme/lifecycle: both paths surface full stdout/stderr to
 * the proxy's stderr so banners (LIFESAVER, NEXUS, AUTO-COMPLETENESS)
 * land in the same place regardless of which path fired. The inline
 * path used to truncate stdout to 200 chars -- banners that grew past
 * that limit vanished for inline fires while remaining visible for
 * /hme/lifecycle fires.
 */
async function runInlineFallback(event, stdinJson) {
  try {
    const r = await hookBridge.dispatchEvent(event, stdinJson);
    if (r.stderr && r.stderr.length > 0) {
      process.stderr.write(`inline ${event} stderr:\n${r.stderr}\n`);
    }
    if (r.stdout && r.stdout.length > 0) {
      process.stderr.write(`inline ${event} stdout:\n${r.stdout}\n`);
    }
  } catch (err) {
    console.error(`inline ${event} failed: ${err.message}`);
  }
}

/**
 * Lifecycle bridge route. The forwarder script POSTs here with:
 *   - query ?event=<EventName>
 *   - body = the Claude Code hook stdin JSON payload
 * We dispatch to the appropriate bash hook chain and respond with JSON:
 *   {stdout: "...", stderr: "...", exit_code: <int>}
 * The forwarder script relays each field back to Claude Code's plugin
 * machinery, preserving block decisions, banners, and exit codes.
 */
function handleLifecycleRoute(clientReq, clientRes) {
  const json = (status, body) => {
    clientRes.writeHead(status, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify(body));
  };
  if (clientReq.method !== 'POST') return json(405, { error: 'POST only' });
  const url = new URL(clientReq.url, 'http://127.0.0.1');
  const event = url.searchParams.get('event') || '';
  if (!event) return json(400, { error: 'missing ?event=<EventName>' });
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', async () => {
    const stdin = Buffer.concat(chunks).toString('utf8') || '{}';
    // Mark Claude Code's hook system as active for this event so inline
    // fallback fires don't double-invoke it.
    recordLifecycleHit(event);
    // Log receipt so we can verify the forwarder path is active. Fallback
    // callers always run through inline (no POST) so this log existing =
    // Claude Code's hook system is reaching us.
    console.error(`/hme/lifecycle received event=${event} (${stdin.length}B)`);
    let _dispatchErr = null;
    let _result = null;
    try {
      _result = await hookBridge.dispatchEvent(event, stdin);
      json(200, _result);
    } catch (err) {
      _dispatchErr = err;
      console.error(`lifecycle dispatch threw: ${err.message}`);
      json(500, { stdout: '', stderr: `dispatch error: ${err.message}`, exit_code: -1 });
    }
    // EXHAUSTIVE LIFECYCLE DUMP: every hook stdin + result -> blank-debug/
    // dir. Lets us correlate "no API request followed UserPromptSubmit"
    // with the actual hook decision (block? injectAdditionalContext?
    // crash?) instead of spelunking through proxy log.
    try {
      const _lcPath = require('path');
      const _lcFs = require('fs');
      const { PROJECT_ROOT } = require('./shared');
      const _lcDir = _lcPath.join(PROJECT_ROOT, 'tmp', 'blank-debug');
      try { _lcFs.mkdirSync(_lcDir, { recursive: true }); } catch (_e) { /* ignore */ }
      // Cap blank-debug to 500 newest files per writer prefix. Without rotation the dir grew to 3.4GB (8617 files) before the cleanup. Keep enough history for forensics, prune the rest.
      try {
        const _existing = _lcFs.readdirSync(_lcDir).filter((f) => f.startsWith('hme-lc-'));
        if (_existing.length > 500) {
          const _sorted = _existing.map((f) => ({ f, m: _lcFs.statSync(_lcPath.join(_lcDir, f)).mtimeMs })).sort((a, b) => a.m - b.m);
          for (let _i = 0; _i < _sorted.length - 500; _i++) {
            try { _lcFs.unlinkSync(_lcPath.join(_lcDir, _sorted[_i].f)); } catch (_e2) { /* ignore */ }
          }
        }
      } catch (_e) { /* best-effort rotation; never block dispatch */ }
      const _ts = new Date().toISOString().replace(/[:.]/g, '-');
      const _file = _lcPath.join(_lcDir, `hme-lc-${_ts}-${process.pid}-${event}.json`);
      let _stdinParsed = null;
      try { _stdinParsed = JSON.parse(stdin); } catch (_e) { /* keep raw */ }
      _lcFs.writeFileSync(_file, JSON.stringify({
        ts: new Date().toISOString(),
        kind: 'lifecycle',
        event,
        stdin_bytes: stdin.length,
        stdin_raw: stdin,
        stdin_parsed: _stdinParsed,
        result: _result,
        dispatch_error: _dispatchErr ? { message: _dispatchErr.message, stack: _dispatchErr.stack } : null,
        proxy_pid: process.pid,
      }, null, 2));
    } catch (_e) { console.error(`lifecycle dump failed: ${_e.message}`); }
  });
  clientReq.on('error', (err) => {
    if (!clientRes.headersSent) json(500, { error: err.message });
  });
}

// Side effect: fire SessionStart inline at module load. If Claude Code
// hits /hme/lifecycle with SessionStart shortly after, we'll note the
// dup but it's harmless (sessionstart.sh is idempotent w.r.t. its
// state writes). Module require caching guarantees this runs once per
// process even if multiple modules require this file.
runInlineFallback('SessionStart', '{}');

module.exports = {
  recordLifecycleHit,
  lifecycleInactive,
  runInlineFallback,
  handleLifecycleRoute,
};
