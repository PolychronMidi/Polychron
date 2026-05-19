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

test('Codex native Read response rewrites to executable bridge and back to Read history', () => {
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
  assert.equal(call.name, 'exec_command');
  const args = JSON.parse(call.arguments);
  assert.match(args.cmd, /hme_tools\/run_tool\.py Read --json/);
  assert.match(args.cmd, /doc\/self-coherence\.md/);
  const normalized = normalizeStructuredBridgeCalls(rewritten.body).body.output[0];
  assert.equal(normalized.name, 'Read');
  assert.deepEqual(JSON.parse(normalized.arguments), { file_path: 'doc/self-coherence.md', limit: 5 });
});


test('Codex native Bash response rewrites to exec_command with command->cmd shape', () => {
  const response = { output: [{ type: 'function_call', name: 'Bash', arguments: JSON.stringify({ command: 'echo hello', description: 'greet' }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'exec_command');
  const args = JSON.parse(call.arguments);
  assert.equal(args.cmd, 'echo hello');
  assert.equal(args.justification, 'greet');
  assert.equal(rewritten.stats.calls, 1);
});

test('Codex native Write response rewrites to bridge write and normalizes back', () => {
  const response = { output: [{ type: 'function_call', name: 'Write', arguments: JSON.stringify({ file_path: 'doc/x.md', content: 'hello' }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'exec_command');
  assert.match(JSON.parse(call.arguments).cmd, /hme_tools\/run_tool\.py Write --json/);
  const normalized = normalizeStructuredBridgeCalls(rewritten.body).body.output[0];
  assert.equal(normalized.name, 'Write');
  assert.equal(JSON.parse(normalized.arguments).file_path, 'doc/x.md');
});

test('Codex native WebSearch response rewrites to codex web_search', () => {
  const response = { output: [{ type: 'function_call', name: 'WebSearch', arguments: JSON.stringify({ query: 'foo', allowed_domains: ['x.com'] }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'web_search');
  const args = JSON.parse(call.arguments);
  assert.equal(args.query, 'foo');
  assert.deepEqual(args.allowed_domains, ['x.com']);
});

test('Codex native WebFetch response rewrites to bridge web_fetch', () => {
  const response = { output: [{ type: 'function_call', name: 'WebFetch', arguments: JSON.stringify({ url: 'https://x.com', prompt: 'summary' }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'exec_command');
  assert.match(JSON.parse(call.arguments).cmd, /hme_tools\/run_tool\.py WebFetch --json/);
});

test('Codex native Agent response rewrites to bridge agent', () => {
  const response = { output: [{ type: 'function_call', name: 'Agent', arguments: JSON.stringify({ prompt: 'go', level: 3 }) }] };
  const rewritten = rewriteCodexResponseObject(response);
  const call = rewritten.body.output[0];
  assert.equal(call.name, 'exec_command');
  assert.match(JSON.parse(call.arguments).cmd, /hme_tools\/run_tool\.py Agent --json/);
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
  assert.match(out, /hme_tools\/run_tool\.py Edit --json/);
  assert.equal(rewriter.stats.calls, 1);
});

test('Codex SSE Write/WebFetch/Agent calls rewrite to exec_command bridges', () => {
  const make = (name, args) => ({ type: 'response.output_item.done', item: { type: 'function_call', name, arguments: JSON.stringify(args) } });
  for (const [name, args, pattern] of [
    ['Write', { file_path: 'doc/x.md', content: 'hi' }, /hme_tools\/run_tool\.py Write --json/],
    ['WebFetch', { url: 'https://example.com', prompt: 'sum' }, /hme_tools\/run_tool\.py WebFetch --json/],
    ['Agent', { prompt: 'go', level: 2 }, /hme_tools\/run_tool\.py Agent --json/],
  ]) {
    const rewriter = createNativeToolSseRewriter();
    const out = rewriter.feed(Buffer.from(`data: ${JSON.stringify(make(name, args))}\n\n`));
    assert.match(out, /exec_command/, `${name} should rewrite to exec_command`);
    assert.match(out, pattern, `${name} should use the right bridge action`);
    assert.equal(rewriter.stats.calls, 1, `${name} should bump calls`);
  }
});

test('Codex SSE Bash and WebSearch calls rewrite to native targets', () => {
  const make = (name, args) => ({ type: 'response.output_item.done', item: { type: 'function_call', name, arguments: JSON.stringify(args) } });
  const r1 = createNativeToolSseRewriter();
  const o1 = r1.feed(Buffer.from(`data: ${JSON.stringify(make('Bash', { command: 'echo hello' }))}\n\n`));
  assert.match(o1, /"name":"exec_command"/);
  assert.match(o1, /\\"cmd\\":\\"echo hello\\"/);
  const r2 = createNativeToolSseRewriter();
  const o2 = r2.feed(Buffer.from(`data: ${JSON.stringify(make('WebSearch', { query: 'foo' }))}\n\n`));
  assert.match(o2, /"name":"web_search"/);
  assert.match(o2, /\\"query\\":\\"foo\\"/);
});

test('Codex SSE unknown function_call name is reported in rewriter stats', () => {
  const rewriter = createNativeToolSseRewriter();
  const event = { type: 'response.output_item.done', item: { type: 'function_call', name: 'spawn_agent', arguments: '{}' } };
  rewriter.feed(Buffer.from(`data: ${JSON.stringify(event)}\n\n`));
  assert.equal(rewriter.stats.unknown_calls, 1);
  assert.deepEqual(rewriter.stats.unknown_names, ['spawn_agent']);
});

test('Codex proxy sends native tools upstream and translates native Read call with visible streamed progress', async () => {
  const proxyPort = await freePort();
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      upstreamBodies.push(body);
      if (upstreamBodies.length === 1) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const call = {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            name: 'Read',
            call_id: 'call_read_proxy_loop',
            arguments: JSON.stringify({ file_path: 'doc/templates/AGENTS.md', limit: 2 }),
          },
        };
        res.end(`data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_read', output: [] } })}\n\ndata: ${JSON.stringify(call)}\n\ndata: [DONE]\n\n`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const finalEvents = [
        { type: 'response.created', response: { id: 'resp_final', output: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'done' },
        { type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'done' },
        { type: 'response.completed', response: { id: 'resp_final', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] } },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
      res.end(`${finalEvents}data: [DONE]\n\n`);
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
    const response = await requestJson(proxyPort, { model: 'gpt-5.5', tools: [], stream: true });
    assert.equal(response.status, 200);
    assert.deepEqual(upstreamBodies[0].tools.map((t) => t.name), ['Agent', 'Bash', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Write']);
    assert.equal(upstreamBodies.length, 2);
    assert.equal(upstreamBodies[1].previous_response_id, 'resp_read');
    assert.equal(upstreamBodies[1].input[0].type, 'function_call_output');
    assert.equal(upstreamBodies[1].input[0].call_id, 'call_read_proxy_loop');
    assert.match(upstreamBodies[1].input[0].output, /# Rules/);
    assert.equal(JSON.parse(response.body).output[0].content[0].text, 'done');
    assert.doesNotMatch(response.body, /exec_command|codex_structured_tool|HME_CODEX_JSON/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});
