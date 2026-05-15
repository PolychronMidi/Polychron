#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawnFileInput } = require('../event_kernel/fs_ipc');
const { loadJsonc } = require('./config_loader');
const proxyAutocommit = require('./middleware/21_proxy_autocommit');
const { readAutocommitFailure, touchLifesaverHeartbeat } = require('./lifesaver_alerts');
const { PROJECT_ROOT, RUNTIME_DIR } = require('./shared');
const { servicePort } = require('./service_registry');

const PORT = servicePort('codex_proxy');
const PROXY_VERSION = 'hme-codex-proxy/1';
const CONFIG_PATH = process.env.HME_CODEX_PROXY_CONFIG
  || path.join(PROJECT_ROOT, 'tools', 'HME', 'config', 'codex-proxy.json');
const PLAN_SYNC = process.env.HME_CODEX_PLAN_SYNC_SCRIPT
  || path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts', 'codex_plan_sync.py');
const EVENT_LOG = path.join(RUNTIME_DIR, 'codex-proxy-events.jsonl');
const DEFAULT_UPSTREAM = 'https://chatgpt.com/backend-api/codex/responses';
const UPSTREAM_URL = process.env.HME_CODEX_UPSTREAM_URL || DEFAULT_UPSTREAM;
const MAX_BODY_BYTES = Number(process.env.HME_CODEX_PROXY_MAX_BODY_BYTES || 64 * 1024 * 1024);

let _config = null;
let _recent = [];
const _seenPlanCalls = new Map();

function loadConfig() {
  if (_config) return _config;
  try {
    _config = loadJsonc(CONFIG_PATH);
  } catch (err) {
    _config = {
      todo_sync: { enabled: true },
      request_transform: {},
      _load_error: err.message,
    };
  }
  return _config;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch (_e) { return {}; }
}

function appendJsonl(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch (err) {
    process.stderr.write(`[codex_proxy] event log write failed: ${err.message}\n`);
  }
}

function record(row) {
  const event = { ts: nowIso(), ...row };
  _recent.push(event);
  if (_recent.length > 100) _recent = _recent.slice(-100);
  appendJsonl(EVENT_LOG, event);
}

function parseCodexMetadata(req) {
  const raw = req.headers['x-codex-turn-metadata'];
  if (!raw || Array.isArray(raw)) return {};
  const parsed = safeJson(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function readRequestBody(req, res) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let closed = false;
    req.on('data', (chunk) => {
      if (closed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        closed = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'codex_proxy_body_too_large', max_bytes: MAX_BODY_BYTES }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!closed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (closed) return;
      closed = true;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'codex_proxy_request_error', message: err.message }));
    });
  });
}

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  if (typeof tool.name === 'string') return tool.name;
  if (tool.function && typeof tool.function.name === 'string') return tool.function.name;
  if (typeof tool.type === 'string') return tool.type;
  return '';
}

function requestStats(body) {
  const instructions = typeof body.instructions === 'string' ? body.instructions : '';
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    model: body.model || '',
    instruction_bytes: Buffer.byteLength(instructions),
    tool_count: tools.length,
    tool_names: tools.map(toolName).filter(Boolean).slice(0, 120),
    stream: Boolean(body.stream),
  };
}

function runCodexAutocommit() {
  if (process.env.HME_CODEX_PROXY_AUTOCOMMIT === '0') return 'disabled';
  try {
    proxyAutocommit.onRequest({
      payload: { messages: [{ role: 'user', content: '' }] },
      ctx: { PROJECT_ROOT },
    });
    return 'ran';
  } catch (err) {
    record({ kind: 'autocommit-crash', message: err.message, stack: err.stack });
    return 'crashed';
  }
}

function appendInstructions(body, note) {
  const current = typeof body.instructions === 'string' ? body.instructions : '';
  return {
    ...body,
    instructions: current ? `${current}\n\n${note}` : note,
  };
}

function injectCodexLifesaver(body) {
  touchLifesaverHeartbeat(PROJECT_ROOT);
  const failure = readAutocommitFailure(PROJECT_ROOT);
  if (!failure) return { body, injected: false };
  return {
    body: appendInstructions(body, `[lifesaver inject from codex proxy]\n${failure.banner}`),
    injected: true,
    flag: failure.flagPath,
  };
}

function disabledToolSet(cfg) {
  const fromConfig = cfg?.request_transform?.disabled_tools;
  const raw = process.env.HME_CODEX_DISABLED_TOOLS || '';
  const names = Array.isArray(fromConfig) ? fromConfig : [];
  return new Set([
    ...names.map((x) => String(x).trim()).filter(Boolean),
    ...raw.split(',').map((x) => x.trim()).filter(Boolean),
  ]);
}

function extraInstructions(cfg) {
  const parts = [];
  const inline = process.env.HME_CODEX_EXTRA_INSTRUCTIONS || cfg?.request_transform?.extra_instructions || '';
  if (inline) parts.push(String(inline));
  const file = process.env.HME_CODEX_INSTRUCTION_APPEND_FILE || cfg?.request_transform?.instruction_append_file || '';
  if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(PROJECT_ROOT, file);
    try { parts.push(fs.readFileSync(abs, 'utf8').trim()); }
    catch (err) { record({ kind: 'config-warning', message: `instruction append file unreadable: ${err.message}` }); }
  }
  return parts.filter(Boolean).join('\n\n');
}

function applyRequestTransform(body) {
  const cfg = loadConfig();
  const before = requestStats(body);
  const disabled = disabledToolSet(cfg);
  const transformed = { ...body };
  if (disabled.size && Array.isArray(body.tools)) {
    transformed.tools = body.tools.filter((tool) => !disabled.has(toolName(tool)));
  }
  const extra = extraInstructions(cfg);
  if (extra) {
    transformed.instructions = `${typeof body.instructions === 'string' ? body.instructions : ''}\n\n${extra}`;
  }
  const after = requestStats(transformed);
  const warnInstructionBytes = Number(cfg?.request_transform?.max_instruction_bytes_warn || 0);
  const warnToolCount = Number(cfg?.request_transform?.max_tool_count_warn || 0);
  if ((warnInstructionBytes && after.instruction_bytes > warnInstructionBytes)
      || (warnToolCount && after.tool_count > warnToolCount)) {
    record({
      kind: 'bloat-warning',
      instruction_bytes: after.instruction_bytes,
      tool_count: after.tool_count,
      max_instruction_bytes_warn: warnInstructionBytes,
      max_tool_count_warn: warnToolCount,
    });
  }
  return { body: transformed, before, after };
}

function stableCallKey(candidate, source) {
  const id = candidate.call_id || candidate.id || candidate.item_id || '';
  const args = typeof candidate.arguments === 'string' ? candidate.arguments : JSON.stringify(candidate.arguments || '');
  return `${source.thread_id || ''}:${source.turn_id || ''}:${id}:${args}`;
}

function rememberPlanCall(key) {
  const now = Date.now();
  _seenPlanCalls.set(key, now);
  if (_seenPlanCalls.size > 500) {
    for (const [k, t] of _seenPlanCalls.entries()) {
      if (now - t > 60 * 60 * 1000 || _seenPlanCalls.size > 500) _seenPlanCalls.delete(k);
    }
  }
}

function normalizePlanPayload(args, source) {
  const plan = args && args.plan;
  if (!Array.isArray(plan)) return null;
  return {
    plan,
    explanation: typeof args.explanation === 'string' ? args.explanation : '',
    timestamp: nowIso(),
    session_file: source.thread_id ? `codex-proxy:${source.thread_id}` : 'codex-proxy',
  };
}

function syncPlanArguments(argumentsText, source, candidate) {
  const cfg = loadConfig();
  if (cfg?.todo_sync && cfg.todo_sync.enabled === false) return;
  let args;
  try {
    args = typeof argumentsText === 'string' ? JSON.parse(argumentsText || '{}') : argumentsText;
  } catch (_e) {
    return;
  }
  const payload = normalizePlanPayload(args, source);
  if (!payload) return;
  const key = stableCallKey(candidate, source);
  if (_seenPlanCalls.has(key)) return;
  rememberPlanCall(key);
  record({ kind: 'todo-sync-start', items: payload.plan.length, session_file: payload.session_file });
  spawnFileInput('python3', [PLAN_SYNC, 'sync-payload', '--json'], {
    input: JSON.stringify(payload),
    timeoutMs: 30_000,
    cwd: PROJECT_ROOT,
    env: { PROJECT_ROOT },
    label: 'codex-plan-sync',
  }).then((result) => {
    if (result.exit_code === 0) {
      let parsed = null;
      try { parsed = safeJson(result.stdout.trim()); } catch (_e) { parsed = null; }
      record({ kind: 'todo-sync-ok', result: parsed || result.stdout.trim().slice(0, 500) });
    } else {
      record({
        kind: 'todo-sync-failed',
        exit_code: result.exit_code,
        stderr: (result.stderr || '').slice(0, 1000),
        stdout: (result.stdout || '').slice(0, 1000),
      });
    }
  });
}

function maybePlanCandidate(obj, source) {
  if (!obj || typeof obj !== 'object') return;
  const name = obj.name || (obj.function && obj.function.name);
  const args = obj.arguments || obj.arguments_json || (obj.function && obj.function.arguments);
  const type = obj.type || obj.item_type || '';
  const nameLooksRight = name === 'update_plan';
  const typeLooksRight = type === 'function_call' || type === 'tool_call' || nameLooksRight;
  if (nameLooksRight && typeLooksRight && args) syncPlanArguments(args, source, obj);
}

function scanObjectForPlan(obj, source, seen = new Set()) {
  if (!obj || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);
  maybePlanCandidate(obj, source);
  if (Array.isArray(obj)) {
    for (const item of obj) scanObjectForPlan(item, source, seen);
    return;
  }
  for (const value of Object.values(obj)) scanObjectForPlan(value, source, seen);
}

class SsePlanScanner {
  constructor(source) {
    this.source = source;
    this.buffer = '';
    this.dataLines = [];
  }

  feed(chunk) {
    this.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const rawLine = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        this.flushEvent();
      } else if (line.startsWith('data:')) {
        this.dataLines.push(line.slice(5).trimStart());
      }
    }
  }

  flushEvent() {
    if (!this.dataLines.length) return;
    const data = this.dataLines.join('\n');
    this.dataLines = [];
    if (!data || data === '[DONE]') return;
    try { scanObjectForPlan(JSON.parse(data), this.source); }
    catch (_e) { /* non-JSON data frames are ignored */ }
  }

  finish() {
    this.flushEvent();
  }
}

function upstreamHeaders(req, bodyBytes) {
  const headers = { ...req.headers };
  for (const key of ['host', 'content-length', 'connection', 'transfer-encoding', 'trailer', 'upgrade']) {
    delete headers[key];
  }
  headers['content-length'] = String(bodyBytes.length);
  return headers;
}

function forwardResponses(req, res, body, bodyBytes, source) {
  const upstream = new URL(UPSTREAM_URL);
  const client = upstream.protocol === 'http:' ? http : https;
  const options = {
    method: 'POST',
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'http:' ? 80 : 443),
    path: `${upstream.pathname}${upstream.search}`,
    headers: upstreamHeaders(req, bodyBytes),
  };
  const upstreamReq = client.request(options, (upstreamRes) => {
    const headers = { ...upstreamRes.headers };
    res.writeHead(upstreamRes.statusCode || 502, headers);
    const contentType = String(upstreamRes.headers['content-type'] || '');
    if (contentType.includes('text/event-stream')) {
      const scanner = new SsePlanScanner(source);
      upstreamRes.on('data', (chunk) => {
        scanner.feed(chunk);
        res.write(chunk);
      });
      upstreamRes.on('end', () => {
        scanner.finish();
        res.end();
      });
      return;
    }
    const chunks = [];
    upstreamRes.on('data', (chunk) => {
      chunks.push(chunk);
      res.write(chunk);
    });
    upstreamRes.on('end', () => {
      const full = Buffer.concat(chunks).toString('utf8');
      const parsed = safeJson(full);
      if (parsed && typeof parsed === 'object') scanObjectForPlan(parsed, source);
      res.end();
    });
  });
  upstreamReq.on('error', (err) => {
    record({ kind: 'upstream-error', message: err.message });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'codex_proxy_upstream_error',
        message: err.message,
        upstream: UPSTREAM_URL,
      }));
    } else {
      res.end();
    }
  });
  upstreamReq.write(bodyBytes);
  upstreamReq.end();
}

async function handleResponses(req, res) {
  const rawBody = await readRequestBody(req, res);
  if (!rawBody) return;
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'codex_proxy_invalid_json', message: err.message }));
    return;
  }
  const meta = parseCodexMetadata(req);
  const source = {
    session_id: meta.session_id || '',
    thread_id: meta.thread_id || '',
    turn_id: meta.turn_id || '',
    originator: req.headers.originator || '',
  };
  const autocommit = runCodexAutocommit();
  const lifesaver = injectCodexLifesaver(body);
  const { body: transformed, before, after } = applyRequestTransform(lifesaver.body);
  record({
    kind: 'request',
    source,
    upstream: UPSTREAM_URL,
    autocommit,
    lifesaver_injected: lifesaver.injected,
    lifesaver_flag: lifesaver.flag || '',
    before,
    after,
    transformed: lifesaver.injected || JSON.stringify(before) !== JSON.stringify(after),
  });
  forwardResponses(req, res, transformed, Buffer.from(JSON.stringify(transformed)), source);
}

function handleRequest(req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      component: 'hme-codex-proxy',
      version: PROXY_VERSION,
      port: PORT,
      upstream: UPSTREAM_URL,
      config: CONFIG_PATH,
    }));
    return;
  }
  if (req.url === '/hme/codex/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ recent: _recent.slice(-100) }));
    return;
  }
  if (req.method === 'POST' && (req.url === '/v1/responses' || req.url === '/responses')) {
    handleResponses(req, res).catch((err) => {
      record({ kind: 'request-crash', message: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'codex_proxy_crash', message: err.message }));
      } else {
        res.end();
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', component: 'hme-codex-proxy' }));
}

http.createServer(handleRequest).listen(PORT, '127.0.0.1', () => {
  record({ kind: 'startup', port: PORT, upstream: UPSTREAM_URL, config: CONFIG_PATH });
  process.stderr.write(`[codex_proxy] listening on 127.0.0.1:${PORT}, upstream=${UPSTREAM_URL}\n`);
});
