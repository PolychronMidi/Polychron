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

test('Codex request transform replaces upstream tools with Claude uniform surface', () => {
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    instructions: 'test',
    tools: [
      { type: 'function', name: 'exec_command' },
      { type: 'function', name: 'apply_patch' },
      { type: 'function', name: 'web_search' },
      { type: 'function', name: 'spawn_agent' },
      { type: 'function', name: 'image_generation' },
    ],
  }, {
    loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }),
    record: () => {},
    projectRoot: repoRoot,
  });
  assert.deepEqual(result.after.tool_names, ['Agent', 'Bash', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Write']);
  assert.equal(result.cleanup.native_tools_added, 7);
});

test('Codex native Read response stays visible as Read', () => {
  const response = {
    output: [{
      type: 'function_call',
      name: 'Read',
      call_id: 'call_read',
      arguments: JSON.stringify({ file_path: 'doc/self-coherence.md', limit: 5 }),
    }],
  };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'Read');
  assert.deepEqual(JSON.parse(call.arguments), { file_path: 'doc/self-coherence.md', limit: 5 });
  assert.equal(rewritten.stats.calls, 0);
  assert.doesNotMatch(JSON.stringify(rewritten.body), /exec_command|codex_structured_tool|HME_CODEX_JSON/);
});


test('Codex native Bash response stays visible as Bash', () => {
  const response = { output: [{ type: 'function_call', name: 'Bash', arguments: JSON.stringify({ command: 'echo hello', description: 'greet' }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'Bash');
  assert.deepEqual(JSON.parse(call.arguments), { command: 'echo hello', description: 'greet' });
  assert.equal(rewritten.stats.calls, 0);
});

test('Codex native Write response stays visible as Write', () => {
  const response = { output: [{ type: 'function_call', name: 'Write', arguments: JSON.stringify({ file_path: 'doc/x.md', content: 'hello' }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'Write');
  assert.deepEqual(JSON.parse(call.arguments), { file_path: 'doc/x.md', content: 'hello' });
  assert.doesNotMatch(JSON.stringify(rewritten.body), /exec_command|codex_structured_tool|HME_CODEX_JSON/);
});

test('Codex native WebSearch response stays visible as WebSearch', () => {
  const response = { output: [{ type: 'function_call', name: 'WebSearch', arguments: JSON.stringify({ query: 'foo', allowed_domains: ['x.com'] }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'WebSearch');
  const args = JSON.parse(call.arguments);
  assert.equal(args.query, 'foo');
  assert.deepEqual(args.allowed_domains, ['x.com']);
});

test('Codex native WebFetch response stays visible as WebFetch', () => {
  const response = { output: [{ type: 'function_call', name: 'WebFetch', arguments: JSON.stringify({ url: 'https://x.com', prompt: 'summary' }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'WebFetch');
  assert.deepEqual(JSON.parse(call.arguments), { url: 'https://x.com', prompt: 'summary' });
});

test('Codex native Agent response stays visible as Agent', () => {
  const response = { output: [{ type: 'function_call', name: 'Agent', arguments: JSON.stringify({ prompt: 'go', level: 3 }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'Agent');
  assert.deepEqual(JSON.parse(call.arguments), { prompt: 'go', level: 3 });
});

test('Codex bridge heredoc text normalizes without leaking heredoc header', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js read --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: 'doc/templates/AGENTS.md', offset: 0, limit: 5 }),
    'HME_CODEX_JSON',
    'after',
  ].join('\n');
  const normalized = normalizeStructuredBridgeCalls({ text: cmd });
  assert.equal(
    normalized.body.text,
    'Read doc/templates/AGENTS.md lines 1-5\nafter',
  );
  assert.equal(normalized.stats.text_rewrites, 1);
});

test('Codex bridge heredoc inside exec_command normalizes without marker leakage', () => {
  const cmd = [
    "node tools/HME/scripts/codex_structured_tool.js read --json <<'HME_CODEX_JSON'",
    JSON.stringify({ file_path: '$PROJECT_ROOT/tools/HME/runtime/INVENTORY.md', offset: 25, limit: 10 }),
    'HME_CODEX_JSON',
  ].join('\n');
  const input = {
    output: [{
      type: 'function_call',
      name: 'exec_command',
      arguments: JSON.stringify({ cmd }),
    }],
  };
  const normalized = normalizeStructuredBridgeCalls(input).body.output[0];
  assert.equal(normalized.name, 'Read');
  assert.deepEqual(JSON.parse(normalized.arguments), {
    file_path: '$PROJECT_ROOT/tools/HME/runtime/INVENTORY.md',
    offset: 25,
    limit: 10,
  });
  assert.doesNotMatch(JSON.stringify(normalized), /HME_CODEX_JSON|<<|codex_structured_tool/);
});

test('Codex SSE native Edit response stays visible before forwarding', () => {
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
  assert.match(out, /"name":"Edit"/);
  assert.doesNotMatch(out, /exec_command|codex_structured_tool|HME_CODEX_JSON/);
  assert.equal(rewriter.stats.calls, 0);
});

test('Codex SSE Write/WebFetch/Agent calls stay visible', () => {
  const make = (name, args) => ({ type: 'response.output_item.done', item: { type: 'function_call', name, arguments: JSON.stringify(args) } });
  for (const [name, args] of [
    ['Write', { file_path: 'doc/x.md', content: 'hi' }],
    ['WebFetch', { url: 'https://example.com', prompt: 'sum' }],
    ['Agent', { prompt: 'go', level: 2 }],
  ]) {
    const rewriter = createNativeToolSseRewriter();
    const out = rewriter.feed(Buffer.from(`data: ${JSON.stringify(make(name, args))}\n\n`));
    assert.match(out, new RegExp(`\"name\":\"${name}\"`));
    assert.doesNotMatch(out, /exec_command|codex_structured_tool|HME_CODEX_JSON/);
    assert.equal(rewriter.stats.calls, 0, `${name} should not need a raw-command rewrite`);
  }
});

test('Codex SSE Bash and WebSearch calls stay visible', () => {
  const make = (name, args) => ({ type: 'response.output_item.done', item: { type: 'function_call', name, arguments: JSON.stringify(args) } });
  const r1 = createNativeToolSseRewriter();
  const o1 = r1.feed(Buffer.from(`data: ${JSON.stringify(make('Bash', { command: 'echo hello' }))}\n\n`));
  assert.match(o1, /"name":"Bash"/);
  assert.match(o1, /\\"command\\":\\"echo hello\\"/);
  const r2 = createNativeToolSseRewriter();
  const o2 = r2.feed(Buffer.from(`data: ${JSON.stringify(make('WebSearch', { query: 'foo' }))}\n\n`));
  assert.match(o2, /"name":"WebSearch"/);
  assert.match(o2, /\\"query\\":\\"foo\\"/);
});

test('Codex SSE unknown function_call name is reported in rewriter stats', () => {
  const rewriter = createNativeToolSseRewriter();
  const event = { type: 'response.output_item.done', item: { type: 'function_call', name: 'spawn_agent', arguments: '{}' } };
  rewriter.feed(Buffer.from(`data: ${JSON.stringify(event)}\n\n`));
  assert.equal(rewriter.stats.unknown_calls, 1);
  assert.deepEqual(rewriter.stats.unknown_names, ['spawn_agent']);
});

test('Codex proxy sends native tools upstream and translates native call response', async () => {
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
          arguments: JSON.stringify({ file_path: 'doc/self-coherence.md', limit: 2 }),
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
    assert.deepEqual(upstreamBody.tools.map((t) => t.name), ['Agent', 'Bash', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Write']);
    const call = JSON.parse(response.body).output[0];
    assert.equal(call.name, 'Read');
    assert.deepEqual(JSON.parse(call.arguments), { file_path: 'doc/self-coherence.md', limit: 2 });
    assert.doesNotMatch(response.body, /exec_command|codex_structured_tool|HME_CODEX_JSON/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});
