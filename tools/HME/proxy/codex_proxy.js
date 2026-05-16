#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { loadJsonc } = require('./config_loader');
const { runAutocommit, injectLifesaver } = require('./turn_side_effects');
const { applyRequestTransform } = require('./codex_payload');
const { rewriteCodexResponseObject, createNativeToolSseRewriter } = require('./codex_native_tools');
const { targetChain, targetSummary } = require('./codex_omniroute');
const { createPlanScanner } = require('./codex_plan_scanner');
const { PROJECT_ROOT, RUNTIME_DIR } = require('./shared');
const { requestTelemetry } = require('./request_telemetry');
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

const PROXY_GIT_SHA = (() => {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 1000 }).trim();
  } catch (_e) { return 'unknown'; }
})();
const PROXY_STARTED_AT = new Date().toISOString();

let _config = null;
let _recent = [];

function loadConfig() {
  if (_config) return _config;
  try {
    _config = loadJsonc(CONFIG_PATH);
  } catch (err) {
    _config = { todo_sync: { enabled: true }, request_transform: {}, _load_error: err.message };
  }
  return _config;
}

function nowIso() { return new Date().toISOString(); }

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

const planScanner = createPlanScanner({ loadConfig, record, nowIso, planSync: PLAN_SYNC, projectRoot: PROJECT_ROOT });

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

function runCodexAutocommit() {
  return runAutocommit({
    host: 'codex',
    projectRoot: PROJECT_ROOT,
    record,
    disabled: process.env.HME_CODEX_PROXY_AUTOCOMMIT === '0',
  });
}

function injectCodexLifesaver(body) {
  return injectLifesaver({ body, host: 'codex', projectRoot: PROJECT_ROOT });
}

function upstreamHeaders(req, bodyBytes, target) {
  const headers = { ...req.headers };
  for (const key of ['host', 'content-length', 'connection', 'transfer-encoding', 'trailer', 'upgrade']) {
    delete headers[key];
  }
  if (target.kind === 'omniroute') {
    delete headers.authorization;
    delete headers['x-api-key'];
    headers['x-hme-codex-proxy'] = '1';
    if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
  }
  headers['content-length'] = String(bodyBytes.length);
  return headers;
}

function responseUsage(parsed) {
  const usage = parsed && typeof parsed === 'object' ? parsed.usage : null;
  if (!usage || typeof usage !== 'object') return {};
  return {
    tokens_in: Number(usage.input_tokens || usage.prompt_tokens || 0),
    tokens_out: Number(usage.output_tokens || usage.completion_tokens || 0),
  };
}

function forwardResponses(req, res, targets, source, visibility) {
  const started = Date.now();
  let finished = false;

  function finishResponse(target, status, errorSummary = '', parsed = null) {
    if (finished) return;
    finished = true;
    record({
      kind: 'response',
      route: target.kind,
      upstream: target.url,
      status,
      duration_ms: Date.now() - started,
      error_summary: errorSummary,
      ...responseUsage(parsed),
      model: target.body && target.body.model ? target.body.model : visibility.model,
    });
  }

  function attemptTarget(index) {
    const target = targets[index];
    const bodyBytes = Buffer.from(JSON.stringify(target.body));
    const upstream = new URL(target.url);
  const client = upstream.protocol === 'http:' ? http : https;
  const options = {
    method: 'POST',
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'http:' ? 80 : 443),
    path: `${upstream.pathname}${upstream.search}`,
      headers: upstreamHeaders(req, bodyBytes, target),
  };
  const upstreamReq = client.request(options, (upstreamRes) => {
      const status = upstreamRes.statusCode || 502;
      if (target.fallbackDirect && target.fallbackHttpStatuses && target.fallbackHttpStatuses.has(status) && targets[index + 1]) {
        const chunks = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          record({
            kind: 'upstream-http-fallback',
            route: target.kind,
            upstream: target.url,
            status,
            body_preview: Buffer.concat(chunks).toString('utf8').slice(0, 500),
          });
          attemptTarget(index + 1);
        });
        return;
      }
    const headers = { ...upstreamRes.headers };
    delete headers['content-length'];
    const contentType = String(upstreamRes.headers['content-type'] || '');
    res.writeHead(status, headers);
    if (contentType.includes('text/event-stream')) {
      const scanner = planScanner.createSseScanner(source);
      const rewriter = createNativeToolSseRewriter();
      upstreamRes.on('data', (chunk) => {
        const out = rewriter.feed(chunk);
        if (out) { scanner.feed(Buffer.from(out)); res.write(out); }
      });
      upstreamRes.on('end', () => {
        const tail = rewriter.finish();
        if (tail) { scanner.feed(Buffer.from(tail)); res.write(tail); }
        scanner.finish();
        res.end();
          finishResponse(target, status);
      });
      return;
    }
    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const full = Buffer.concat(chunks).toString('utf8');
      const parsed = safeJson(full);
      const rewritten = parsed && typeof parsed === 'object' ? rewriteCodexResponseObject(parsed) : null;
      const finalBody = rewritten && rewritten.stats.calls ? JSON.stringify(rewritten.body) : full;
      const finalParsed = rewritten ? rewritten.body : parsed;
      if (finalParsed && typeof finalParsed === 'object') planScanner.scanObjectForPlan(finalParsed, source);
      res.end(finalBody);
        finishResponse(target, status, '', finalParsed);
    });
  });
  upstreamReq.on('error', (err) => {
      record({ kind: 'upstream-error', route: target.kind, upstream: target.url, message: err.message });
      if (target.fallbackDirect && targets[index + 1] && !res.headersSent) {
        attemptTarget(index + 1);
        return;
      }
      finishResponse(target, 502, err.message);
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

  attemptTarget(0);
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
  const source = { session_id: meta.session_id || '', thread_id: meta.thread_id || '', turn_id: meta.turn_id || '', originator: req.headers.originator || '' };
  const autocommit = runCodexAutocommit();
  const lifesaver = injectCodexLifesaver(body);
  const { body: transformed, before, after, cleanup, payload_log: payloadLog } = applyRequestTransform(lifesaver.body, {
    loadConfig,
    record,
    projectRoot: PROJECT_ROOT,
  });
  const targets = targetChain(transformed, UPSTREAM_URL, loadConfig);
  record({
    kind: 'request',
    source,
    upstream: targets[0].url,
    route: targets[0].kind,
    targets: targetSummary(targets),
    telemetry: requestTelemetry({ host: 'codex', protocol: 'openai-responses', provider: targets[0].kind, route: targets[0].kind, path: req.url, body: transformed, before, after, cleanup }),
    autocommit,
    lifesaver_injected: lifesaver.injected,
    lifesaver_flag: lifesaver.flag || '',
    before,
    after,
    cleanup,
    payload_log: payloadLog,
    transformed: lifesaver.injected || JSON.stringify(before) !== JSON.stringify(after),
  });
  forwardResponses(req, res, targets, source, {
    source,
    upstream: targets[0].url,
    model: after.model || before.model || '',
    before,
    after,
    cleanup,
    transformed: lifesaver.injected || JSON.stringify(before) !== JSON.stringify(after),
  });
}

function handleRequest(req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', component: 'hme-codex-proxy', version: PROXY_VERSION, git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT, port: PORT, upstream: UPSTREAM_URL, route: targetSummary(targetChain({ model: 'health' }, UPSTREAM_URL, loadConfig)), config: CONFIG_PATH }));
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
  record({ kind: 'startup', port: PORT, upstream: UPSTREAM_URL, config: CONFIG_PATH, git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT });
  process.stderr.write(`[codex_proxy] listening on 127.0.0.1:${PORT}, upstream=${UPSTREAM_URL}\n`);
});
