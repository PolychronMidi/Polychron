'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { applyRequestTransform } = require('../../proxy/codex_payload');
const { normalizeStructuredBridgeCalls } = require('../../proxy/codex_tool_text');
const { rewriteCodexResponseObject, createNativeToolSseRewriter } = require('../../proxy/codex_native_tools');

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
      try { if (await fn()) return resolve(true); } catch (_e) { /* retry */ }
      if (Date.now() - start > timeoutMs) return reject(new Error(`condition not met after ${timeoutMs}ms`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function requestJson(port, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/v1/responses', method: 'POST',
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

test('Codex request transform injects upstream Read/Edit schemas', () => {
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    instructions: 'test',
    tools: [{ type: 'function', name: 'exec_command' }],
  }, {
    loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }),
    record: () => {},
    projectRoot: repoRoot,
  });
  assert.deepEqual(result.after.tool_names.slice(-2), ['Read', 'Edit']);
  assert.equal(result.cleanup.native_tools_added, 2);
});

test('Codex native Read response rewrites to executable bridge and back to Read history', () => {
  const response = {
    output: [{
      type: 'function_call',
      name: 'Read',
      call_id: 'call_read',
      arguments: JSON.stringify({ file_path: 'doc/HME.md', limit: 5 }),
    }],
  };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'exec_command');
  const args = JSON.parse(call.arguments);
  assert.match(args.cmd, /codex_structured_tool\.js read --json/);
  assert.match(args.cmd, /doc\/HME\.md/);
  const normalized = normalizeStructuredBridgeCalls(rewritten.body).body.output[0];
  assert.equal(normalized.name, 'Read');
  assert.deepEqual(JSON.parse(normalized.arguments), { file_path: 'doc/HME.md', limit: 5 });
});

test('Codex SSE native Edit response rewrites before forwarding', () => {
  const rewriter = createNativeToolSseRewriter();
  const event = {
    type: 'response.output_item.done',
    item: {
      type: 'function_call',
      name: 'Edit',
      arguments: JSON.stringify({ file_path: 'a.txt', old_string: 'a', new_string: 'b' }),
    },
  };
  const out = rewriter.feed(Buffer.from(`data: ${JSON.stringify(event)}\n\n`));
  assert.match(out, /exec_command/);
  assert.match(out, /codex_structured_tool\.js edit --json/);
  assert.equal(rewriter.stats.calls, 1);
});

test('Codex proxy sends Read/Edit upstream and translates native call response', async () => {
  const proxyPort = await freePort();
  let upstreamBody = null;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'resp_read',
        output: [{
          type: 'function_call',
          name: 'Read',
          arguments: JSON.stringify({ file_path: 'doc/HME.md', limit: 2 }),
        }],
      }));
    });
  });
  const upstreamPort = await new Promise((resolve) => upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port)));
  const child = spawn('node', [path.join(repoRoot, 'tools', 'HME', 'proxy', 'codex_proxy.js')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HME_CODEX_PROXY_PORT: String(proxyPort),
      HME_CODEX_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/v1/responses`,
      HME_CODEX_OMNIROUTE: '0',
      HME_CODEX_PROXY_AUTOCOMMIT: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  try {
    await waitFor(() => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: proxyPort, path: '/health', timeout: 500 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    }));
    const response = await requestJson(proxyPort, { model: 'gpt-5.5', tools: [], stream: false });
    assert.equal(response.status, 200);
    assert.deepEqual(upstreamBody.tools.map((t) => t.name), ['Read', 'Edit']);
    const call = JSON.parse(response.body).output[0];
    assert.equal(call.name, 'exec_command');
    assert.match(JSON.parse(call.arguments).cmd, /codex_structured_tool\.js read --json/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});
