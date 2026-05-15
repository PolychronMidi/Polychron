'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitFor(fn, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await fn();
        if (value) return resolve(value);
      } catch (_e) {
        // retry until timeout
      }
      if (Date.now() - start > timeoutMs) return reject(new Error(`condition not met after ${timeoutMs}ms`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function requestJson(port, route, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function withSandbox() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-codex-proxy-test-'));
  fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'KB'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'doc', 'templates'), { recursive: true });
  const prodEnv = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
  const secretKey = (key) => [
    /_TOKEN$/, /_KEY$/, /_SECRET$/, /_PASSWORD$/, /_PASSWD$/,
    /_API_KEY$/, /_AUTH$/, /_CREDENTIALS?$/,
    /^TELEGRAM_/, /^ANTHROPIC_/, /^OPENAI_/, /^GITHUB_/,
  ].some((re) => re.test(key));
  const sandboxEnv = prodEnv.split('\n').map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) return line;
    const key = m[1];
    if (key === 'PROJECT_ROOT') return `PROJECT_ROOT=${sandbox}`;
    if (secretKey(key)) return `${key}=REDACTED-FOR-TEST`;
    return line;
  }).join('\n');
  fs.writeFileSync(path.join(sandbox, '.env'), sandboxEnv, { mode: 0o600 });
  fs.writeFileSync(path.join(sandbox, 'CLAUDE.md'), '# sandbox\n');
  fs.writeFileSync(
    path.join(sandbox, 'tools', 'HME', 'KB', 'todos.json'),
    JSON.stringify([{ id: 0, _meta: { max_id: 0, updated_ts: 0 } }]),
  );
  return sandbox;
}

test('Codex Responses proxy syncs streamed update_plan calls into TODO.md', async () => {
  const sandbox = withSandbox();
  const proxyPort = await freePort();
  const upstream = http.createServer((req, res) => {
    req.resume();
    const updateArgs = JSON.stringify({
      explanation: 'proxy stream test',
      plan: [
        { step: 'Proxy captures Codex plan', status: 'in_progress' },
        { step: 'TODO.md receives Codex plan', status: 'pending' },
      ],
    });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        name: 'update_plan',
        arguments: updateArgs,
        call_id: 'call_codex_proxy_test',
      },
    })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_test', output: [] } })}\n\n`);
    res.end();
  });
  const upstreamPort = await new Promise((resolve) => upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port)));
  const child = spawn('node', [path.join(repoRoot, 'tools', 'HME', 'proxy', 'codex_proxy.js')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PROJECT_ROOT: sandbox,
      PYTHONPATH: path.join(repoRoot, 'tools', 'HME', 'service'),
      HME_CODEX_PROXY_PORT: String(proxyPort),
      HME_CODEX_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/v1/responses`,
      HME_CODEX_PLAN_SYNC_SCRIPT: path.join(repoRoot, 'tools', 'HME', 'scripts', 'codex_plan_sync.py'),
      HME_CODEX_PROXY_CONFIG: path.join(repoRoot, 'tools', 'HME', 'config', 'codex-proxy.json'),
      HME_CODEX_PROXY_AUTOCOMMIT: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  try {
    await waitFor(() => {
      return new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: proxyPort, path: '/health', timeout: 500 }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
    });
    const response = await requestJson(proxyPort, '/v1/responses', {
      model: 'gpt-5.5',
      instructions: 'test',
      tools: [{ type: 'function', name: 'update_plan' }],
      stream: true,
    });
    assert.strictEqual(response.status, 200);
    await waitFor(() => {
      const todoMd = path.join(sandbox, 'doc', 'templates', 'TODO.md');
      return fs.existsSync(todoMd) && fs.readFileSync(todoMd, 'utf8').includes('Proxy captures Codex plan');
    }, 10000);
    const todoMd = fs.readFileSync(path.join(sandbox, 'doc', 'templates', 'TODO.md'), 'utf8');
    assert.match(todoMd, /## Now[\s\S]*Proxy captures Codex plan/);
    assert.match(todoMd, /## Next[\s\S]*TODO\.md receives Codex plan/);
  } catch (err) {
    const eventsPath = path.join(sandbox, 'runtime', 'hme', 'codex-proxy-events.jsonl');
    const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8') : '(no codex proxy events)';
    err.message = `${err.message}\nproxy stderr:\n${stderr}\nproxy events:\n${events}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
  assert.doesNotMatch(stderr, /SyntaxError|TypeError|ReferenceError/);
});

test('Codex Responses proxy injects autocommit fail flags into instructions', async () => {
  const sandbox = withSandbox();
  const flagDir = path.join(sandbox, 'runtime', 'hme');
  fs.mkdirSync(flagDir, { recursive: true });
  fs.writeFileSync(
    path.join(flagDir, 'autocommit.fail'),
    '[2026-05-15T00:00:00Z] [test] synthetic autocommit failure\n',
  );
  const proxyPort = await freePort();
  let upstreamBody = '';
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_test', output: [] }));
    });
  });
  const upstreamPort = await new Promise((resolve) => upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port)));
  const child = spawn('node', [path.join(repoRoot, 'tools', 'HME', 'proxy', 'codex_proxy.js')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PROJECT_ROOT: sandbox,
      PYTHONPATH: path.join(repoRoot, 'tools', 'HME', 'service'),
      HME_CODEX_PROXY_PORT: String(proxyPort),
      HME_CODEX_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/v1/responses`,
      HME_CODEX_PLAN_SYNC_SCRIPT: path.join(repoRoot, 'tools', 'HME', 'scripts', 'codex_plan_sync.py'),
      HME_CODEX_PROXY_CONFIG: path.join(repoRoot, 'tools', 'HME', 'config', 'codex-proxy.json'),
      HME_CODEX_PROXY_AUTOCOMMIT: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  try {
    await waitFor(() => {
      return new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: proxyPort, path: '/health', timeout: 500 }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
    });
    const response = await requestJson(proxyPort, '/v1/responses', {
      model: 'gpt-5.5',
      instructions: 'test',
      tools: [],
      stream: false,
    });
    assert.strictEqual(response.status, 200);
    assert.match(upstreamBody, /LIFESAVER - AUTOCOMMIT FAILED/);
    assert.match(upstreamBody, /synthetic autocommit failure/);
  } catch (err) {
    const eventsPath = path.join(sandbox, 'runtime', 'hme', 'codex-proxy-events.jsonl');
    const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8') : '(no codex proxy events)';
    err.message = `${err.message}\nproxy stderr:\n${stderr}\nproxy events:\n${events}\nupstream body:\n${upstreamBody}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
  assert.doesNotMatch(stderr, /SyntaxError|TypeError|ReferenceError/);
});
