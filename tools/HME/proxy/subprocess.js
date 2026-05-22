'use strict';

const { spawn, spawnSync, execFile, execFileSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 30_000;

function runSync(cmd, args = [], opts = {}) {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    timeout,
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exit: typeof result.status === 'number' ? result.status : (result.signal ? -1 : 1),
    signal: result.signal || null,
    durationMs: Date.now() - started,
    timedOut: !!(result.error && result.error.code === 'ETIMEDOUT'),
    error: result.error || null,
  };
}

function run(cmd, args = [], opts = {}) {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    const timer = timeout > 0 ? setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (_) { /* best-effort */ }
    }, timeout) : null;
    if (child.stdout) child.stdout.on('data', (c) => stdoutChunks.push(c));
    if (child.stderr) child.stderr.on('data', (c) => stderrChunks.push(c));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exit: typeof code === 'number' ? code : (signal ? -1 : 1),
        signal: signal || null,
        durationMs: Date.now() - started,
        timedOut,
      });
    });
    if (opts.input != null && child.stdin) {
      child.stdin.end(opts.input);
    }
  });
}

function captureSync(cmd, args = [], opts = {}) {
  const r = runSync(cmd, args, opts);
  if (r.exit !== 0) {
    const err = new Error(`subprocess failed: ${cmd} ${args.join(' ')} exit=${r.exit}${r.timedOut ? ' (timeout)' : ''}`);
    err.result = r;
    throw err;
  }
  return r.stdout;
}

module.exports = { run, runSync, captureSync, DEFAULT_TIMEOUT_MS };
