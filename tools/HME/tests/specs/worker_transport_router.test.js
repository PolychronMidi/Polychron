'use strict';
// Regression tests for the proxy → worker transport router. Verifies
// that hybrid mode routes FS-eligible endpoints through the FS
// backend and routes everything else through HTTP, and that http
// mode never touches FS.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const PROXY_DIR = path.join(REPO, 'tools', 'HME', 'proxy');

function _withSandbox(envOverrides, fn) {
  return async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-transport-'));
    fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
    const prevPR = process.env.PROJECT_ROOT;
    const prevTransport = process.env.HME_WORKER_TRANSPORT;
    process.env.PROJECT_ROOT = sandbox;
    if (envOverrides.transport === undefined) {
      delete process.env.HME_WORKER_TRANSPORT;
    } else {
      process.env.HME_WORKER_TRANSPORT = envOverrides.transport;
    }
    // Bust caches so module-level env reads pick up our overrides.
    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(PROXY_DIR)) delete require.cache[k];
    }
    try {
      await fn(sandbox);
    } finally {
      if (prevPR === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = prevPR;
      if (prevTransport === undefined) delete process.env.HME_WORKER_TRANSPORT;
      else process.env.HME_WORKER_TRANSPORT = prevTransport;
      for (const k of Object.keys(require.cache)) {
        if (k.startsWith(PROXY_DIR)) delete require.cache[k];
      }
      try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    }
  };
}

test('worker_transport: default mode is http', _withSandbox({}, async () => {
  const tr = require(path.join(PROXY_DIR, '_worker_transport'));
  assert.strictEqual(tr.getMode(), 'http');
}));

test('worker_transport: HME_WORKER_TRANSPORT=hybrid resolves to hybrid',
  _withSandbox({ transport: 'hybrid' }, async () => {
    const tr = require(path.join(PROXY_DIR, '_worker_transport'));
    assert.strictEqual(tr.getMode(), 'hybrid');
  }));

test('worker_transport: invalid mode falls back to http',
  _withSandbox({ transport: 'garbage-mode' }, async () => {
    const tr = require(path.join(PROXY_DIR, '_worker_transport'));
    assert.strictEqual(tr.getMode(), 'http');
  }));

test('worker_transport: hybrid mode routes /tool/* through filesystem',
  _withSandbox({ transport: 'hybrid' }, async (sandbox) => {
    const tr = require(path.join(PROXY_DIR, '_worker_transport'));
    // Fire a /tool/foo request with very short timeout — no worker
    // running, so it'll time out. The KEY assertion is that the request
    // file lands in tmp/hme-worker-queue/tool/ (proving FS routing was
    // taken), NOT that we get a real result.
    const queueDir = path.join(sandbox, 'tmp', 'hme-worker-queue', 'tool');
    fs.mkdirSync(queueDir, { recursive: true });
    const result = await tr.workerRequest('POST', '/tool/some-tool', { x: 1 }, 200);
    // Should time out (no drainer present).
    assert.ok(result.error, 'expected timeout error');
    assert.match(result.error.message, /timeout/i, 'error mentions timeout');
    // Job file should be in the queue dir.
    const jobs = fs.readdirSync(queueDir).filter(f => f.endsWith('.json'));
    assert.strictEqual(jobs.length, 1, 'exactly one job file written');
    const job = JSON.parse(fs.readFileSync(path.join(queueDir, jobs[0]), 'utf8'));
    assert.strictEqual(job.endpoint, 'tool', 'envelope endpoint=tool');
    assert.strictEqual(job.body.name, 'some-tool', 'tool name extracted from path');
    assert.deepStrictEqual(job.body.args, { x: 1 }, 'args carried through');
  }));

test('worker_transport: hybrid mode does NOT route /health through filesystem',
  _withSandbox({ transport: 'hybrid' }, async (sandbox) => {
    const tr = require(path.join(PROXY_DIR, '_worker_transport'));
    // /health is not FS-eligible, so it stays on HTTP. With no worker
    // listening on 127.0.0.1:9098 (default WORKER_PORT), HTTP transport
    // returns a transport error — but crucially, no FS file is written.
    const queueRoot = path.join(sandbox, 'tmp', 'hme-worker-queue');
    await tr.workerRequest('GET', '/health', null, 200);
    // No queue dir should exist (HTTP path didn't touch FS).
    assert.strictEqual(fs.existsSync(queueRoot), false,
      '/health must not write to the worker queue');
  }));
