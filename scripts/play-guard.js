// scripts/play-guard.js - guard to ensure only one play runs at a time
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

LOCK_DIR = path.join(process.cwd(), 'tmp');
LOCK_PATH = path.join(LOCK_DIR, 'play.lock');
FIN_PATH = path.join(process.cwd(), 'output', 'play.finished.json');

// Heartbeat/lock reclaim configuration (tunable via env for tests)
HEARTBEAT_INTERVAL_MS = Number(process.env.PLAY_GUARD_HEARTBEAT_MS) || 1000; // update heartbeat every second
STALE_MS = Number(process.env.PLAY_GUARD_STALE_MS) || (30 * 1000); // consider owner stale after 30s
GRACE_MS = Number(process.env.PLAY_GUARD_GRACE_MS) || 2000; // grace period before SIGKILL when reclaiming


isPidAlive = function isPidAlive(pid) {
  try {
    // signal 0 only tests for existence
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// Lightweight lock helpers exported for use by `src/main.js` so that main.js can be
// invoked directly (tests sometimes do this) without duplicating behavior.
writeLock = function writeLock() {
  try { if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true }); } catch (e) { /* swallow */ }
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, when: new Date().toISOString() }), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e && e.code === 'EEXIST') return false;
    throw e;
  }
}

acquireLock = function acquireLock() {
  // Try to acquire lock. If already held by a running process, fail fast (do not queue).
  if (writeLock()) {
    console.log('Acquired play lock');
    return;
  }

  // Lock exists; check if owner process is alive
  try {
    const data = fs.readFileSync(LOCK_PATH, 'utf8');
    const obj = JSON.parse(data);
    if (obj && obj.pid && isPidAlive(obj.pid)) {
      // If the lock is owned by our parent (the play-guard), treat it as transient and attempt to replace it.
      if (typeof process.ppid !== 'undefined' && obj.pid === process.ppid) {
        try { fs.unlinkSync(LOCK_PATH); } catch (_) { /* swallow */ }
        if (!writeLock()) { console.error('Unable to acquire play lock after replacing guard lock; exiting'); process.exit(2); }
        console.log('Acquired play lock (replaced guard lock)');
        return;
      }
      console.error('New concurrent main.js instance requested; exiting');
      process.exit(2);
    }
    // Stale lock — remove and try once
    try { fs.unlinkSync(LOCK_PATH); } catch (_) { /* swallow */ }
    if (!writeLock()) { console.error('Unable to acquire play lock after removing stale lock; exiting'); process.exit(2); }
    console.log('Acquired play lock');
  } catch (e) {
    console.error('Error checking play lock', e && e.stack ? e.stack : e);
    process.exit(1);
  }
}

releaseLock = function releaseLock() {
  try { if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH); } catch (e) { /* swallow */ }
}

// Main guard behavior (unchanged) but run only when invoked directly so the module may be
// required by `src/main.js` without executing the guard loop.
main = async function main() {
  try {
    if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });

    if (fs.existsSync(LOCK_PATH)) {
      try {
        const data = fs.readFileSync(LOCK_PATH, 'utf8');
        const obj = JSON.parse(data);
        if (obj && obj.pid && isPidAlive(obj.pid)) {

            // Detect stale owner via heartbeat or 'when'
            const hb = obj.heartbeat ? Number(obj.heartbeat) : (obj.when ? (new Date(obj.when)).getTime() : null);
            const staleMs = STALE_MS;
            const age = hb ? (Date.now() - hb) : Infinity;
            if (age > staleMs) {
              console.error(`Play guard: detected stale lock owner pid=${obj.pid} (age=${age}ms) - attempting reclaim`);
              try {
                // attempt graceful termination
                try { process.kill(obj.pid, 'SIGTERM'); } catch (e) { /* swallow */ }
                // wait grace
                await new Promise(r => setTimeout(r, GRACE_MS));
                if (isPidAlive(obj.pid)) {
                  try { process.kill(obj.pid, 'SIGKILL'); } catch (e) { /* swallow */ }
                  await new Promise(r => setTimeout(r, 500));
                }
              } catch (e) { /* swallow reclaim errors */ }

              // If owner is dead, remove lock and proceed; else bail out with message
              if (!isPidAlive(obj.pid)) {
                try { fs.unlinkSync(LOCK_PATH); console.error('Play guard: reclaimed stale lock'); } catch (e) { /* swallow */ }
              } else {
                console.error('Play guard: owner still alive after reclaim attempts; refusing to remove lock');
                if (process.env && process.env.PLAY_GUARD_FAIL_ON_BUSY) {
                  process.exit(5);
                }
                // proceed to wait as usual
              }
            }

            if (fs.existsSync(LOCK_PATH)) {
              console.error(`Play guard: another play is running (pid=${obj.pid}). Waiting until it finishes...`);
              // If test harness requests fail-fast behavior, exit quickly instead of waiting
              if (process.env && process.env.PLAY_GUARD_FAIL_ON_BUSY) {
                console.error('Play guard: failing fast due to PLAY_GUARD_FAIL_ON_BUSY');
                process.exit(5);
              }

              // Poll until lock is removed or owner dies; but guard waiting must be bounded to avoid infinite queue buildup
              const waitStart = Date.now();
              const maxWaitMs = Number(process.env.PLAY_GUARD_MAX_WAIT_MS) || 60 * 1000; // default 60s
              while (fs.existsSync(LOCK_PATH)) {
                // If we've waited too long, optionally fail fast to avoid deadlock buildup
                if ((Date.now() - waitStart) > maxWaitMs) {
                  console.error(`Play guard: waited ${Date.now() - waitStart}ms for lock; failing due to timeout${process.env.PLAY_GUARD_MAX_WAIT_MS ? ' (override set)' : ''}`);
                  // Honor explicit fail-on-busy if set by caller
                  if (process.env && process.env.PLAY_GUARD_FAIL_ON_BUSY) {
                    process.exit(5);
                  }
                  // As a conservative fallback, break out and attempt to acquire lock: this avoids leaving many waiters hung
                  break;
                }
                try {
                  const d = fs.readFileSync(LOCK_PATH, 'utf8');
                  const o = JSON.parse(d);
                  if (!o || !o.pid || !isPidAlive(o.pid)) {
                    try { fs.unlinkSync(LOCK_PATH); } catch (_) { /* swallow */ }
                    break;
                  }
                } catch (e) {
                  try { fs.unlinkSync(LOCK_PATH); } catch (_) { /* swallow */ }
                  break;
                }
                // sleep
                await new Promise(r => setTimeout(r, 200));
              }
            }

        } else {
          // stale lock
          fs.unlinkSync(LOCK_PATH);
        }
      } catch (e) {
        // remove corrupted/stale lock file
        try { fs.unlinkSync(LOCK_PATH); } catch (_) { /* swallow */ }
      }
    }

    const lock = { pid: process.pid, when: new Date().toISOString(), heartbeat: Date.now() };
    fs.writeFileSync(LOCK_PATH, JSON.stringify(lock));
    console.log(`Play guard: starting play (pid=${process.pid})`);

    // start periodic heartbeat so other waiters can detect a live owner
    const heartbeatInterval = setInterval(() => {
      try {
        if (!fs.existsSync(LOCK_PATH)) return;
        const d = fs.readFileSync(LOCK_PATH, 'utf8');
        const o = JSON.parse(d);
        if (o && o.pid === process.pid) {
          o.heartbeat = Date.now();
          fs.writeFileSync(LOCK_PATH, JSON.stringify(o));
        }
      } catch (e) { /* swallow */ }
    }, HEARTBEAT_INTERVAL_MS);

    const child = spawn(process.execPath, ['src/main.js'], { stdio: 'inherit', shell: false });
    // Write child pid to lock for diagnostics
    try {
      if (child && child.pid) {
        const d = fs.readFileSync(LOCK_PATH, 'utf8');
        const o = JSON.parse(d);
        o.childPid = child.pid;
        fs.writeFileSync(LOCK_PATH, JSON.stringify(o));
      }
    } catch (e) { /* swallow */ }

    child.on('close', (code, sig) => {
      try {
        if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
      } catch (e) { /* swallow */ }
      const fin = { when: new Date().toISOString(), exitCode: code, signal: sig };
      try { fs.mkdirSync(path.join(process.cwd(),'output'), { recursive: true }); fs.writeFileSync(FIN_PATH, JSON.stringify(fin, null, 2)); } catch (e) { /* swallow */ }
      console.log(`Play guard: child exited (code=${code}, signal=${sig})`);

      // stop heartbeat
      try { clearInterval(heartbeatInterval); } catch (e) { /* swallow */ }

      // Post-run: fail if any CRITICAL diagnostics were emitted during this run.
      try {
          const { checkCriticalsSince } = require('./play-guard-check');
          let relevant = checkCriticalsSince(lock.when);

          if (relevant && relevant.length > 0) {
            console.error(`Play guard: Detected ${relevant.length} critical error(s) emitted during play run; failing guard.`);
            relevant.slice(0,5).forEach(r => console.error('CRITICAL:', r.key || r.type, r.msg || '', r.when));
            process.exit(4);
          }

      } catch (e) { /* swallow check errors to avoid masking child exit */ }

      process.exit(code);
    });

    child.on('error', (err) => {
      try { if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH); } catch (_e) { /* swallow */ }
      console.error('Play guard: failed to spawn play child:', err && err.message);
      process.exit(3);
    });

    // Ensure we clean up on signals and propagate to child when possible
    const cleanupAndExit = (code) => {
      try { if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH); } catch (e) { /* swallow */ }
      try { if (child && typeof child.kill === 'function') child.kill('SIGTERM'); } catch (e) { /* swallow */ }
      try { clearInterval(heartbeatInterval); } catch (e) { /* swallow */ }
      process.exit(code || 1);
    };
    ['SIGINT','SIGTERM','SIGHUP'].forEach(sig => {
      try { process.on(sig, () => cleanupAndExit(128)); } catch (e) { /* some platforms don't support certain signals */ }
    });

    // Ensure we don't leave the lock behind if the guard process exits unexpectedly
    process.on('exit', (code) => {
      try { if (fs.existsSync(LOCK_PATH)) {
        const data = fs.readFileSync(LOCK_PATH, 'utf8');
        const o = JSON.parse(data);
        // Only remove lock if we are the owner
        if (o && o.pid === process.pid) {
          try { fs.unlinkSync(LOCK_PATH); } catch (e) { /* swallow */ }
        }
      } } catch (e) { /* swallow */ }
    });
    // Also ensure we don't leave the lock behind if the guard process exits unexpectedly
    process.on('exit', (code) => {
      try { if (fs.existsSync(LOCK_PATH)) {
        const data = fs.readFileSync(LOCK_PATH, 'utf8');
        const o = JSON.parse(data);
        // Only remove lock if we are the owner
        if (o && o.pid === process.pid) {
          try { fs.unlinkSync(LOCK_PATH); } catch (e) { /* swallow */ }
        }
      } } catch (e) { /* swallow */ }
    });

  } catch (e) {
    console.error('Play guard: unexpected error', e && e.message);
    process.exit(1);
  }
}

if (require.main === module) main();

// Helpers (LOCK_PATH, isPidAlive, acquireLock, releaseLock) are exposed as naked globals by this module.
