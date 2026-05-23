// Spawn hme_proxy.js as a real subprocess, wait for its `listening` marker
// on stdout, hit /health, assert 200, then SIGTERM. Catches the .listen()
// failure modes proxy_exhaustive_require.test.js cannot: server bind errors,
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PROXY_MAIN = path.join(PROJECT_ROOT, 'tools', 'HME', 'proxy', 'hme_proxy.js');

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function httpGet(port, path_) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: path_, timeout: 4000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('http timeout')); });
  });
}

test('hme_proxy.js boots, binds the smoke port, answers /health, and exits cleanly on SIGTERM', async () => {
  const port = await pickFreePort();
  const child = spawn(process.execPath, [PROXY_MAIN], {
    env: {
      ...process.env,
      PROJECT_ROOT,
      HME_PROXY_PORT: String(port),
      HME_PROXY_SUPERVISE: '0',
      HME_PROXY_ENABLED: '1',
      HME_PROXY_QUIET_IMPORT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderrChunks = [];
  child.stderr.on('data', (c) => stderrChunks.push(c));
  const ready = new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`proxy boot timeout; stderr=${Buffer.concat(stderrChunks).toString('utf8').slice(-500)}`)), 8000);
    child.stdout.on('data', (c) => {
      buf += c.toString('utf8');
      if (/hme-proxy listening on/.test(buf)) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code, sig) => {
      clearTimeout(timer);
      reject(new Error(`proxy exited before listening (code=${code} sig=${sig}); stderr=${Buffer.concat(stderrChunks).toString('utf8').slice(-500)}`));
    });
  });
  try {
    await ready;
    const res = await httpGet(port, '/health');
    assert.strictEqual(res.status, 200, `/health expected 200, got ${res.status}`);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.ok, true, `/health body should report ok=true (body=${res.body.slice(0, 200)})`);
    assert.strictEqual(parsed.port, port, `/health body should echo bound port`);
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) { /* ignore */ } resolve(); }, 3000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
    });
  }
});
