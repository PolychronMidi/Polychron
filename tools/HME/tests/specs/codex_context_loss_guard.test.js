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

test('Codex proxy drops incomplete empty Bash calls instead of creating adapter-notice context', async () => {
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
          output: [{ type: 'function_call', id: 'call_empty_bash', call_id: 'call_empty_bash', name: 'Bash', arguments: '{}' }],
        }));
        return;
      }
      res.end(JSON.stringify({ id: 'unexpected_retry', output: [] }));
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
      tools: [{ type: 'function', name: 'Bash' }],
      stream: false,
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamBodies.length, 1);
    assert.doesNotMatch(response.body, /adapter notice|Error: command is required|Please send/);
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
