'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { PROJECT_ROOT } = require('../proxy/shared');

const IPC_ROOT = path.join(PROJECT_ROOT, 'runtime', 'hme', 'event-ipc');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function appendJsonl(file, row) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

function makeInvocation(label, stdinText = '') {
  const safeLabel = String(label || 'event').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80) || 'event';
  ensureDir(IPC_ROOT);
  const dir = fs.mkdtempSync(path.join(IPC_ROOT, `${safeLabel}-`));
  const stdinFile = path.join(dir, 'stdin.json');
  atomicWrite(stdinFile, stdinText || '');
  return {
    dir,
    stdinFile,
    env: { HME_IPC_DIR: dir, HME_IPC_STDIN: stdinFile },
    cleanup() {
      if (process.env.HME_KEEP_EVENT_IPC === '1') return;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
    },
  };
}

function _normalResult(result) {
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exit_code: Number.isInteger(result.status) ? result.status : (result.error ? -1 : 0),
    signal: result.signal || null,
    error: result.error || null,
  };
}

function spawnFileInputSync(command, args = [], opts = {}) {
  const ipc = makeInvocation(opts.label || path.basename(command), opts.input || '');
  try {
    const result = spawnSync('bash', ['-lc', 'exec "$@" < "$HME_IPC_STDIN"', 'hme-ipc', command, ...args], {
      cwd: opts.cwd || PROJECT_ROOT,
      env: { ...process.env, PROJECT_ROOT, ...ipc.env, ...(opts.env || {}) },
      encoding: 'utf8',
      timeout: opts.timeoutMs || 30_000,
      maxBuffer: opts.maxBuffer || 10 * 1024 * 1024,
    });
    return _normalResult(result);
  } finally {
    ipc.cleanup();
  }
}

function spawnFileInput(command, args = [], opts = {}) {
  const ipc = makeInvocation(opts.label || path.basename(command), opts.input || '');
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('bash', ['-lc', 'exec "$@" < "$HME_IPC_STDIN"', 'hme-ipc', command, ...args], {
        cwd: opts.cwd || PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PROJECT_ROOT, ...ipc.env, ...(opts.env || {}) },
      });
    } catch (err) {
      // silent-ok: optional fallback path.
      ipc.cleanup();
      resolve({ stdout: '', stderr: `[fs_ipc] spawn failed for ${command}: ${err.message}`, exit_code: -1, signal: null, error: err });
      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    const timeoutMs = opts.timeoutMs || 30_000;
    const killGroup = (signal) => {
      try { process.kill(-child.pid, signal); }
      catch (_e) {
        try { child.kill(signal); } catch (_e2) { /* best effort */ }
      }
    };
    const timer = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => {
        if (!finished) killGroup('SIGKILL');
      }, 500).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ipc.cleanup();
      resolve({ stdout, stderr: `${stderr}\n[fs_ipc] error: ${err.message}`, exit_code: -1, signal: null, error: err });
    });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ipc.cleanup();
      if (timedOut) {
        resolve({ stdout, stderr: `${stderr}\n[fs_ipc] timeout after ${timeoutMs}ms: ${command}`, exit_code: -1, signal: signal || 'SIGTERM', error: null });
        return;
      }
      resolve({ stdout, stderr, exit_code: code ?? 0, signal: signal || null, error: null });
    });
  });
}

function ipcRoot() {
  ensureDir(IPC_ROOT);
  return IPC_ROOT;
}

function tmpdir() {
  return os.tmpdir();
}

module.exports = {
  IPC_ROOT,
  atomicWrite,
  appendJsonl,
  ensureDir,
  ipcRoot,
  makeInvocation,
  spawnFileInput,
  spawnFileInputSync,
  tmpdir,
};
