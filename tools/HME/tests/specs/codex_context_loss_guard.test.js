'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { applyRequestTransform } = require('../../proxy/codex_payload');
const {
  EMPTY_COMMAND_NOTICE,
  CONTEXT_LOSS_NOTICE,
  isContextLossText,
  responseHasContextLoss,
  appendContextLossRepair,
  appendToolSchemaRepair,
} = require('../../proxy/codex_context_loss_guard');

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

function requestJson(port, body, pathName = '/v1/responses') {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: pathName, method: 'POST',
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

function requestGet(port, pathName) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('Codex context-loss guard detects recovered empty-command stalls', () => {
  const bad = [
    'Current recovered state:',
    '- A prior tool call failed with: Error: command is required',
    '- No command was executed.',
    'Please send the actual task you want me to continue with.',
  ].join('\n');
  const adapterBad = [
    'I only have the recovered adapter notices, not the actual prior task/session objective.',
    'They don’t contain actionable project context, file paths, commands, or requirements.',
    'I won’t repeat the empty Bash calls. Please send the current objective or the relevant prior task details, and I’ll continue from there.',
  ].join('\n');
  const promptBad = [
    'Got it. The only recovered tool context is:',
    '> Error: prompt is required',
    'So I know a previous tool call failed because it was missing a required prompt, but I don’t have the actual task objective or project/file context from before that failure.',
    'Please send the task you want me to continue with.',
  ].join('\n');
  assert.equal(isContextLossText(bad), true);
  assert.equal(isContextLossText(adapterBad), true);
  assert.equal(isContextLossText(promptBad), true);
  assert.equal(responseHasContextLoss({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: bad }] }] }), true);
  assert.equal(responseHasContextLoss({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: adapterBad }] }] }), true);
  assert.equal(responseHasContextLoss({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: promptBad }] }] }), true);
  assert.equal(isContextLossText('Error: command is required\nreal shell stderr from an attempted command'), false);
});

test('Codex request transform scrubs stale empty-command tool outputs and assistant stalls', () => {
  const bad = [
    'The only recovered context I have is:',
    '- call_x -> Error: command is required',
    'Please send the actual task you want me to continue with.',
  ].join('\n');
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    input: [
      { type: 'function_call_output', call_id: 'call_x', output: 'Error: command is required' },
      { type: 'function_call_output', call_id: 'call_agent', output: 'Error: prompt is required' },
      { role: 'assistant', content: [{ type: 'output_text', text: bad }] },
    ],
    tools: [],
  }, {
    loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }),
    record: () => {},
    projectRoot: repoRoot,
  });

  const body = JSON.stringify(result.body);
  assert.match(body, /HME adapter notice/);
  assert.match(body, /HME context-loss guard/);
  assert.doesNotMatch(body, /Current recovered state|Please send the actual task|Error: command is required|Error: prompt is required/);
  assert.equal(result.cleanup.codex_context_loss, 3);
  assert.equal(result.cleanup.codex_context_loss_categories.missing_required_tool_output, 2);
  assert.equal(result.cleanup.codex_context_loss_categories.assistant_context_loss_text, 1);
  assert.equal(EMPTY_COMMAND_NOTICE.includes('not task context'), true);
  assert.equal(CONTEXT_LOSS_NOTICE.includes('latest user request'), true);
});

test('Codex context-loss repair prompt carries latest user objective', () => {
  const repaired = appendContextLossRepair({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'fix the Codex resume bug' }] }] });
  const body = JSON.stringify(repaired);
  assert.match(body, /HME context-loss repair/);
  assert.match(body, /fix the Codex resume bug/);
  assert.doesNotMatch(body, /Please send the actual task/);
});

test('Codex tool-schema repair prompt preserves objective and demands valid tool fields', () => {
  const repaired = appendToolSchemaRepair({
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'produce repo-aware design feedback after reading files' }] }],
  }, [
    { call_id: 'call_read', name: 'Read', missing: ['file_path'] },
    { call_id: 'call_agent', name: 'Agent', missing: ['prompt'] },
  ]);
  const body = JSON.stringify(repaired);
  assert.match(body, /HME tool-call repair/);
  assert.match(body, /Read: missing file_path/);
  assert.match(body, /Agent: missing prompt/);
  assert.match(body, /produce repo-aware design feedback after reading files/);
  assert.match(body, /emit valid tool calls with all required fields/);
  assert.match(body, /do not ask the user to paste repo structure/i);
});

test('Codex context-loss guard detects generic no-file-read repo stalls', () => {
  const bad = [
    'You’re right. That was a generic architecture answer dressed up like repo-aware feedback.',
    'I did not successfully read the repo. My attempted file/tool reads failed, and I should have stopped there instead of producing a Polychron-specific sounding report.',
    'If you want, paste repo structure or key files and I can redo this properly.',
  ].join('\n');
  const unsupportedBad = [
    'All tools are currently showing as unsupported, which is a bit tricky.',
    'I attempted to inspect the project root, but the available file/shell tools are currently returning unsupported call for Bash, Read, and Agent, so I have not successfully read the repo yet.',
    'Please provide the files or enable access.',
  ].join('\n');
  assert.equal(isContextLossText(bad), true);
  assert.equal(isContextLossText(unsupportedBad), true);
  assert.equal(responseHasContextLoss({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: bad }] }] }), true);
  assert.equal(responseHasContextLoss({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: unsupportedBad }] }] }), true);
});

test('Codex context-loss guard detects recovered pwd-only resume stalls', () => {
  const bad = [
    'Understood. The recovered working directory is:',
    '',
    '<project-root>',
    '',
    'I don’t have the actual task details from the previous turn—only the pwd output. Tell me what you want done next in this repo, and I’ll continue from there without re-running that same context check unless needed.',
  ].join('\n');
  const genericBad = [
    'I think we can satisfy the user\'s intent without going into literal or overly religious topics.',
    'It seems they might be relying on previous context rather than needing me to use the same tools again unless absolutely necessary.',
    'If there\'s no specific task, I should ask the user.',
    'Acknowledged. I’ll reuse the recovered repository context and avoid repeating the same discovery/listing calls unless there’s a clear need.',
    'Please send the next objective or the specific task you want me to continue.',
  ].join('\n');
  assert.equal(isContextLossText(bad), true);
  assert.equal(isContextLossText(genericBad), true);
  assert.equal(responseHasContextLoss({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: bad }] }] }), true);
  assert.equal(responseHasContextLoss({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: genericBad }] }] }), true);
});

test('Codex proxy retries tool-avoidant ask-next responses with tool-use enforcement', async () => {
  const proxyPort = await freePort();
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      upstreamBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (upstreamBodies.length === 1) {
        res.end(JSON.stringify({
          id: 'resp_tool_avoidant',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Acknowledged. I’ll reuse the recovered repository context and avoid repeating the same discovery/listing calls unless there’s a clear need.\n\nPlease send the next objective or the specific task you want me to continue.' }] }],
        }));
        return;
      }
      if (upstreamBodies.length === 2) {
        res.end(JSON.stringify({
          id: 'resp_after_tool_enforcement',
          output: [{ type: 'function_call', name: 'Read', call_id: 'call_enforced_read', arguments: JSON.stringify({ file_path: 'README.md', limit: 1 }) }],
        }));
        return;
      }
      res.end(JSON.stringify({
        id: 'resp_final_after_real_tool',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'repo-aware response after enforced Read' }] }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'overall Design Pattern optimization suggestions for cleaner intuitive comprehensibility?' }] }],
      tools: [{ type: 'function', name: 'Bash' }, { type: 'function', name: 'Read' }, { type: 'function', name: 'Agent' }],
      stream: false,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 3);
    const repairBody = JSON.stringify(upstreamBodies[1]);
    assert.match(repairBody, /HME tool-use enforcement/);
    assert.match(repairBody, /Use the available tools now/);
    assert.match(repairBody, /overall Design Pattern optimization suggestions/);
    assert.equal(upstreamBodies[2].previous_response_id, 'resp_after_tool_enforcement');
    assert.equal(upstreamBodies[2].input[0].type, 'function_call_output');
    assert.equal(upstreamBodies[2].input[0].call_id, 'call_enforced_read');
    assert.doesNotMatch(response.body, /Please send the next objective|specific task you want me to continue/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});

test('Codex request transform scrubs assistant stalls that cite recovered adapter notices or missing prompts', () => {
  const bad = [
    'I only have the recovered adapter notices, not the actual prior task/session objective.',
    'They don’t contain actionable project context, file paths, commands, or requirements.',
    'I won’t repeat the empty Bash calls. Please send the current objective or the relevant prior task details, and I’ll continue from there.',
  ].join('\n');
  const promptBad = [
    'Got it. The only recovered tool context is:',
    '> Error: prompt is required',
    'So I know a previous tool call failed because it was missing a required prompt, but I don’t have the actual task objective or project/file context from before that failure.',
    'Please send the task you want me to continue with.',
  ].join('\n');
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    input: [
      { role: 'assistant', content: [{ type: 'output_text', text: bad }] },
      { role: 'assistant', content: [{ type: 'output_text', text: promptBad }] },
    ],
    tools: [],
  }, {
    loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }),
    record: () => {},
    projectRoot: repoRoot,
  });

  const body = JSON.stringify(result.body);
  assert.match(body, /HME context-loss guard/);
  assert.doesNotMatch(body, /recovered adapter notices|Please send the current objective|prior task details|Error: prompt is required|Please send the task/);
  assert.equal(result.cleanup.codex_context_loss_categories.assistant_context_loss_text, 2);
});

test('Codex proxy retries streamed tool-avoidant ask-next responses with tool-use enforcement', async () => {
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
        const events = [
          { type: 'response.created', response: { id: 'resp_stream_tool_avoidant' } },
          { type: 'response.output_text.delta', item_id: 'msg_stream_bad', output_index: 0, content_index: 0, delta: 'Acknowledged. I’ll use the recovered package.json context and avoid calling the same tool/read again unless there’s a concrete need.\n\n' },
          { type: 'response.output_text.delta', item_id: 'msg_stream_bad', output_index: 0, content_index: 0, delta: 'I don’t have the actual prior task details in this recovered context, so send the next objective or failure output and I’ll continue from here without re-reading the same package metadata unnecessarily.' },
          { type: 'response.completed', response: { id: 'resp_stream_tool_avoidant' } },
        ];
        res.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
        return;
      }
      if (upstreamBodies.length === 2) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'resp_after_stream_tool_enforcement',
          output: [{ type: 'function_call', name: 'Read', call_id: 'call_stream_enforced_read', arguments: JSON.stringify({ file_path: 'package.json', limit: 1 }) }],
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'resp_final_after_stream_real_tool',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'streaming path recovered after enforced repository Read' }] }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Respond with one sentence only after using a repository file tool. You must first inspect package.json or README.md using available tools; do not ask me for the objective or files.' }] }],
      tools: [{ type: 'function', name: 'Bash' }, { type: 'function', name: 'Read' }, { type: 'function', name: 'Agent' }],
      stream: true,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 3);
    const repairBody = JSON.stringify(upstreamBodies[1]);
    assert.match(repairBody, /HME tool-use enforcement/);
    assert.match(repairBody, /Use the available tools now/);
    assert.match(repairBody, /must first inspect package\.json or README\.md/);
    assert.equal(upstreamBodies[2].previous_response_id, 'resp_after_stream_tool_enforcement');
    assert.equal(upstreamBodies[2].input[0].type, 'function_call_output');
    assert.equal(upstreamBodies[2].input[0].call_id, 'call_stream_enforced_read');
    assert.doesNotMatch(response.body, /send the next objective|recovered package\.json context|actual prior task details/);
    assert.match(response.body, /streaming path recovered after enforced repository Read/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});

test('Codex proxy streams visible tool-loop progress before final streamed answer', async () => {
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
        const events = [
          { type: 'response.created', response: { id: 'resp_visible_tool' } },
          { type: 'response.output_item.added', item: { type: 'function_call', name: 'Read', call_id: 'call_visible_read' } },
          { type: 'response.function_call_arguments.delta', call_id: 'call_visible_read', delta: '{"file_path":"README.md"' },
          { type: 'response.function_call_arguments.delta', call_id: 'call_visible_read', delta: ',"limit":1}' },
          { type: 'response.function_call_arguments.done', call_id: 'call_visible_read', arguments: '{"file_path":"README.md","limit":1}' },
          { type: 'response.completed', response: { id: 'resp_visible_tool' } },
        ];
        res.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'resp_visible_final',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'final streamed answer after visible Read' }] }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'inspect README and answer' }] }],
      tools: [{ type: 'function', name: 'Read' }],
      stream: true,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 2);
    assert.equal(upstreamBodies[1].previous_response_id, 'resp_visible_tool');
    assert.match(response.body, /text\/event-stream|response\.output_text\.delta|Read README\.md|result forwarded upstream|final streamed answer after visible Read/);
    assert.doesNotMatch(response.body, /unsupported call: Bash|"name":"Bash"|codex_proxy_tool_loop_limit|Loop Detected/);
    const metrics = await requestGet(proxyPort, '/hme/codex/metrics');
    assert.equal(metrics.status, 200);
    const recent = JSON.parse(metrics.body).recent;
    const visible = recent.find((event) => event.kind === 'codex-proxy-tool-loop-visible');
    const responseEvent = [...recent].reverse().find((event) => event.kind === 'response');
    assert.ok(visible, 'expected visible tool-loop metric');
    assert.equal(visible.session_id, responseEvent.session_id);
    assert.equal(visible.turn_id, responseEvent.turn_id);
    assert.equal(visible.correlation_id, responseEvent.correlation_id);
    assert.deepEqual(visible.call_ids, ['call_visible_read']);
    assert.equal(responseEvent.client_sse_started, true);
    assert.equal(responseEvent.tool_loop_count, 1);
    assert.ok(responseEvent.client_visible_progress_events > 0);
    assert.equal(recent.some((event) => event.kind === 'codex-hidden-tool-loop-violation'), false);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});

test('Codex proxy finalizes instead of returning 508 when upstream keeps calling tools', async () => {
  const proxyPort = await freePort();
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      upstreamBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (upstreamBodies.length <= 8) {
        res.end(JSON.stringify({
          id: `resp_loop_${upstreamBodies.length}`,
          output: [{ type: 'function_call', name: 'Read', call_id: `call_loop_${upstreamBodies.length}`, arguments: JSON.stringify({ file_path: 'package.json', limit: 1 }) }],
        }));
        return;
      }
      res.end(JSON.stringify({
        id: 'resp_loop_finalized',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'finalized after bounded tool loop' }] }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'inspect package metadata and then answer' }] }],
      tools: [{ type: 'function', name: 'Read' }],
      stream: false,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 9);
    assert.equal(upstreamBodies[8].tool_choice, 'none');
    assert.deepEqual(upstreamBodies[8].tools, []);
    assert.match(JSON.stringify(upstreamBodies[8]), /HME tool-loop finalization/);
    assert.match(response.body, /finalized after bounded tool loop/);
    assert.doesNotMatch(response.body, /codex_proxy_tool_loop_limit|Loop Detected/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});

test('Codex proxy blocks finalization-stage Bash calls instead of leaking unsupported tools', async () => {
  const proxyPort = await freePort();
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      upstreamBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (upstreamBodies.length <= 8) {
        res.end(JSON.stringify({
          id: `resp_loop_bash_${upstreamBodies.length}`,
          output: [{ type: 'function_call', name: 'Read', call_id: `call_loop_bash_${upstreamBodies.length}`, arguments: JSON.stringify({ file_path: 'package.json', limit: 1 }) }],
        }));
        return;
      }
      if (upstreamBodies.length === 9) {
        res.end(JSON.stringify({
          id: 'resp_ignored_finalization_once',
          output: [{ type: 'function_call', name: 'Bash', call_id: 'call_finalization_bash', arguments: JSON.stringify({ command: 'pwd' }) }],
        }));
        return;
      }
      res.end(JSON.stringify({
        id: 'resp_finalization_repaired',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'final answer after blocked finalization tool call' }] }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'inspect package metadata and then answer' }] }],
      tools: [{ type: 'function', name: 'Read' }, { type: 'function', name: 'Bash' }],
      stream: false,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 10);
    assert.equal(upstreamBodies[8].tool_choice, 'none');
    assert.deepEqual(upstreamBodies[8].tools, []);
    assert.equal(upstreamBodies[9].tool_choice, 'none');
    assert.deepEqual(upstreamBodies[9].tools, []);
    assert.match(JSON.stringify(upstreamBodies[9]), /HME tool-loop finalization repair/);
    assert.match(response.body, /final answer after blocked finalization tool call/);
    assert.doesNotMatch(response.body, /unsupported call: Bash|"name":"Bash"|codex_proxy_tool_loop_limit|Loop Detected/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});

test('Codex proxy returns safe fallback if finalization keeps emitting Bash calls', async () => {
  const proxyPort = await freePort();
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      upstreamBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `resp_always_tool_${upstreamBodies.length}`,
        output: [{ type: 'function_call', name: upstreamBodies.length >= 9 ? 'Bash' : 'Read', call_id: `call_always_tool_${upstreamBodies.length}`, arguments: JSON.stringify(upstreamBodies.length >= 9 ? { command: 'pwd' } : { file_path: 'package.json', limit: 1 }) }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'inspect package metadata and then answer' }] }],
      tools: [{ type: 'function', name: 'Read' }, { type: 'function', name: 'Bash' }],
      stream: false,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 10);
    assert.match(response.body, /HME stopped a non-terminating Codex tool loop/);
    assert.match(response.body, /kept emitting tool calls after tools were disabled/);
    assert.doesNotMatch(response.body, /unsupported call: Bash|"name":"Bash"|codex_proxy_tool_loop_limit|Loop Detected/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});

test('Codex proxy retries incomplete-only tool calls instead of passing malformed tool state', async () => {
  const proxyPort = await freePort();
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      upstreamBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (upstreamBodies.length === 1) {
        res.end(JSON.stringify({
          id: 'resp_incomplete_tool',
          output: [
            { type: 'function_call', id: 'call_empty_bash', call_id: 'call_empty_bash', name: 'Bash', arguments: '{}' },
            { type: 'function_call', id: 'call_empty_read', call_id: 'call_empty_read', name: 'Read', arguments: '{}' },
            { type: 'function_call', id: 'call_empty_agent', call_id: 'call_empty_agent', name: 'Agent', arguments: '{"level":3}' },
          ],
        }));
        return;
      }
      res.end(JSON.stringify({
        id: 'resp_after_tool_schema_repair',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'repo inspection continued with valid tool calls' }] }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'produce repo-aware design feedback after reading files' }] }],
      tools: [{ type: 'function', name: 'Bash' }, { type: 'function', name: 'Read' }, { type: 'function', name: 'Agent' }],
      stream: false,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 2);
    const repairBody = JSON.stringify(upstreamBodies[1]);
    assert.match(repairBody, /HME tool-call repair/);
    assert.match(repairBody, /Bash: missing command/);
    assert.match(repairBody, /Read: missing file_path/);
    assert.match(repairBody, /Agent: missing prompt/);
    assert.match(repairBody, /produce repo-aware design feedback after reading files/);
    assert.match(repairBody, /do not ask the user to paste repo structure/i);
    assert.equal(JSON.parse(response.body).output[0].content[0].text, 'repo inspection continued with valid tool calls');
    assert.doesNotMatch(response.body, /adapter notice|Error: command is required|Error: prompt is required|Please send|paste repo structure/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});

test('Codex proxy retries upstream instead of returning recovered empty-command stall', async () => {
  const proxyPort = await freePort();
  const upstreamBodies = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      upstreamBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (upstreamBodies.length === 1) {
        res.end(JSON.stringify({
          id: 'resp_bad_context',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I only have the recovered tool result:\n\nError: command is required\n\nPlease send the actual task you want me to continue with.' }] }],
        }));
        return;
      }
      res.end(JSON.stringify({
        id: 'resp_recovered',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'continuing from the latest objective' }] }],
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
    const response = await requestJson(proxyPort, {
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'continue fixing Codex context coherence' }] }],
      tools: [],
      stream: false,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 2);
    assert.match(JSON.stringify(upstreamBodies[1]), /HME context-loss repair/);
    assert.match(JSON.stringify(upstreamBodies[1]), /continue fixing Codex context coherence/);
    assert.equal(JSON.parse(response.body).output[0].content[0].text, 'continuing from the latest objective');
    assert.doesNotMatch(response.body, /Please send the actual task|Error: command is required/);
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
  }
});
