'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const { applyRequestTransform } = require('../../proxy/codex_payload');

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

function createOmniDb(dbPath) {
  const script = `
import sqlite3
con = sqlite3.connect("${dbPath}")
con.execute("""create table call_logs (
  id text primary key, timestamp text, method text, path text, status integer,
  model text, requested_model text, provider text, account text,
  duration integer, tokens_in integer, tokens_out integer,
  request_type text, source_format text, target_format text,
  api_key_name text, detail_state text, artifact_relpath text,
  artifact_size_bytes integer, artifact_sha256 text, has_request_body integer,
  has_response_body integer, request_summary text, error_summary text
)""")
con.execute("""create table usage_history (
  id integer primary key autoincrement, provider text, model text,
  tokens_input integer, tokens_output integer, status text, success integer,
  latency_ms integer, timestamp text
)""")
con.commit()
con.close()
`;
  const res = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
}

test('Codex payload transform logs shape and strips successful hook autocorrect noise', () => {
  const events = [];
  const cfg = {
    request_transform: {
      cleanup: { enabled: true },
      payload_log: { enabled: true, preview_chars: 80 },
      disabled_tools: [],
    },
  };
  const input = {
    model: 'gpt-5.5',
    instructions: 'test',
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'PreToolUse hook (completed)',
              '  warning: i/ wrapper path auto-corrected -- rewritten to absolute path under PROJECT_ROOT',
              'keep signal',
            ].join('\n'),
          },
          {
            type: 'input_text',
            text: [
              'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked?',
              'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked?',
            ].join('\n'),
          },
          { type: 'input_text', text: '   ' },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'User quote stays: PreToolUse hook (completed)',
          },
        ],
      },
    ],
    tools: [{ type: 'function', name: 'update_plan' }],
    stream: true,
  };
  const result = applyRequestTransform(input, {
    loadConfig: () => cfg,
    record: (row) => events.push(row),
    projectRoot: repoRoot,
  });
  const systemText = result.body.input[0].content[0].text;
  const userText = result.body.input[1].content[0].text;
  assert.doesNotMatch(systemText, /PreToolUse hook \(completed\)/);
  assert.doesNotMatch(systemText, /wrapper path auto-corrected/);
  assert.match(systemText, /keep signal/);
  assert.match(result.body.input[0].content[1].text, /STOP\. Re-read/);
  assert.strictEqual((result.body.input[0].content[1].text.match(/STOP\. Re-read/g) || []).length, 1);
  assert.match(userText, /PreToolUse hook \(completed\)/);
  assert.strictEqual(result.body.input[0].content.length, 2);
  assert.strictEqual(result.cleanup.removed_lines, 3);
  assert.strictEqual(result.cleanup.dropped_empty_text_items, 1);
  assert.strictEqual(result.cleanup.categories.hook_success_lines, 1);
  assert.strictEqual(result.cleanup.categories.autocorrect_lines, 1);
  assert.strictEqual(result.cleanup.categories.duplicate_stop_blocks, 1);
  assert.strictEqual(result.cleanup.categories.empty_text_items, 1);
  assert.strictEqual(result.payload_log.target, 'codex-responses-log-only');
  assert.strictEqual(result.payload_log.after.model, 'gpt-5.5');
  assert.deepStrictEqual(events, []);
});

test('Codex proxy status mode renders payload deltas without prompt text', () => {
  const sandbox = withSandbox();
  const eventsPath = path.join(sandbox, 'runtime', 'hme', 'codex-proxy-events.jsonl');
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, `${JSON.stringify({
    ts: '2026-05-15T19:00:00.000Z',
    kind: 'request',
    transformed: true,
    before: { model: 'gpt-5.5', body_bytes: 200, instruction_bytes: 4, text_bytes: 99, tool_count: 2 },
    after: { model: 'gpt-5.5', body_bytes: 150, instruction_bytes: 4, text_bytes: 49, tool_count: 2 },
    cleanup: { removed_bytes: 50, categories: { hook_success_lines: 1, autocorrect_lines: 1 } },
  })}\n`);
  const script = `
import importlib.util, sys, types
server = types.ModuleType("server")
server.context = types.SimpleNamespace(PROJECT_ROOT="${sandbox}")
sys.modules["server"] = server
sys.modules["server.context"] = server.context
spec = importlib.util.spec_from_file_location("status_modes_codex", "${path.join(repoRoot, 'tools', 'HME', 'service', 'server', 'tools_analysis', 'status_unified', 'status_modes_codex.py')}")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(mod._mode_codex_proxy())
`;
  const res = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  try {
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /Codex proxy payload visibility/);
    assert.match(res.stdout, /200->150 \(-50\)/);
    assert.match(res.stdout, /hook_success_lines=1/);
    assert.doesNotMatch(res.stdout, /secret/i);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});


test('Codex route status mode renders route smoke without prompt text', () => {
  const sandbox = withSandbox();
  const eventsPath = path.join(sandbox, 'runtime', 'hme', 'codex-proxy-events.jsonl');
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, `${JSON.stringify({
    ts: '2026-05-15T20:00:00.000Z',
    kind: 'request',
    route: 'omniroute',
    upstream: 'http://127.0.0.1:20128/v1/responses',
    after: { model: 'gpt-5.5' },
  })}\n${JSON.stringify({
    ts: '2026-05-15T20:00:01.000Z',
    kind: 'response',
    route: 'omniroute',
    upstream: 'http://127.0.0.1:20128/v1/responses',
    model: 'cx/gpt-5.5',
    status: 200,
  })}\n`);
  const script = `
import importlib.util, sys, types
server = types.ModuleType("server")
server.context = types.SimpleNamespace(PROJECT_ROOT="${sandbox}")
sys.modules["server"] = server
sys.modules["server.context"] = server.context
spec = importlib.util.spec_from_file_location("status_modes_codex", "${path.join(repoRoot, 'tools', 'HME', 'service', 'server', 'tools_analysis', 'status_unified', 'status_modes_codex.py')}")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(mod._mode_codex_route())
`;
  const res = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  try {
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /Codex route smoke/);
    assert.match(res.stdout, /codex_proxy latest request: route=omniroute/);
    assert.match(res.stdout, /codex_proxy latest response: route=omniroute status=200/);
    assert.doesNotMatch(res.stdout, /secret prompt/i);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Codex proxy routes through OmniRoute Responses for dashboard visibility', async () => {
  const sandbox = withSandbox();
  const proxyPort = await freePort();
  let directHits = 0;
  let omniBody = null;
  const upstream = http.createServer((req, res) => {
    directHits += 1;
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'resp_direct', usage: { input_tokens: 1, output_tokens: 1 }, output: [] }));
  });
  const upstreamPort = await new Promise((resolve) => upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port)));
  const omni = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      omniBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_omni', usage: { input_tokens: 7, output_tokens: 3 }, output: [] }));
    });
  });
  const omniPort = await new Promise((resolve) => omni.listen(0, '127.0.0.1', () => resolve(omni.address().port)));
  const child = spawn('node', [path.join(repoRoot, 'tools', 'HME', 'proxy', 'codex_proxy.js')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PROJECT_ROOT: sandbox,
      PYTHONPATH: path.join(repoRoot, 'tools', 'HME', 'service'),
      HME_CODEX_PROXY_PORT: String(proxyPort),
      HME_CODEX_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/v1/responses`,
      HME_CODEX_PROXY_CONFIG: path.join(repoRoot, 'tools', 'HME', 'config', 'codex-proxy.json'),
      HME_CODEX_OMNIROUTE_URL: `http://127.0.0.1:${omniPort}/v1/responses`,
      HME_CODEX_OMNIROUTE_PROVIDER: 'cx',
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
    const response = await requestJson(proxyPort, '/v1/responses', {
      model: 'gpt-5.5',
      instructions: 'test',
      tools: [],
      stream: false,
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).id, 'resp_omni');
    assert.strictEqual(directHits, 0);
    assert.strictEqual(omniBody.model, 'cx/gpt-5.5');
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
    omni.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Codex proxy falls back direct when OmniRoute is unavailable', async () => {
  const sandbox = withSandbox();
  const proxyPort = await freePort();
  const missingOmniPort = await freePort();
  let directBody = null;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      directBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_direct', usage: { input_tokens: 2, output_tokens: 1 }, output: [] }));
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
      HME_CODEX_PROXY_CONFIG: path.join(repoRoot, 'tools', 'HME', 'config', 'codex-proxy.json'),
      HME_CODEX_OMNIROUTE_URL: `http://127.0.0.1:${missingOmniPort}/v1/responses`,
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
    const response = await requestJson(proxyPort, '/v1/responses', {
      model: 'gpt-5.5',
      instructions: 'test',
      tools: [],
      stream: false,
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).id, 'resp_direct');
    assert.strictEqual(directBody.model, 'gpt-5.5');
  } catch (err) {
    err.message = `${err.message}\nproxy stderr:\n${stderr}`;
    throw err;
  } finally {
    child.kill('SIGTERM');
    upstream.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

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
