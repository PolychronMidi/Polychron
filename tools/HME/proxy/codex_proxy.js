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
const { extractToolCalls, executeToolCalls, nextToolRequestBody, parseSseToolCalls, MAX_TOOL_LOOP_DEPTH } = require('./codex_tool_loop');
const { targetChain, targetSummary } = require('./codex_omniroute');
const { createPlanScanner } = require('./codex_plan_scanner');
const { PROJECT_ROOT, RUNTIME_DIR } = require('./shared');
const { requestTelemetry } = require('./request_telemetry');
const { servicePort } = require('./service_registry');
const { emitStartMarker } = require('./start_marker');
const { ensureSession, reapDuplicates } = require('./codex_session_guard');
const { isSingleQuotaProbe, blockQuotaProbe } = require('./prompt_spam_guard');

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
let _lastGuardMs = 0;
const _metrics = { requests: 0, omniroute: 0, direct: 0, fallback_direct: 0, errors: 0, duplicate_reaps: 0, last_route: null, last_error: '', last_model: '' };

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
  updateMetrics(row);
  const event = { ts: nowIso(), ...row };
  _recent.push(event);
  if (_recent.length > 100) _recent = _recent.slice(-100);
  appendJsonl(EVENT_LOG, event);
}

const planScanner = createPlanScanner({ loadConfig, record, nowIso, planSync: PLAN_SYNC, projectRoot: PROJECT_ROOT });

function updateMetrics(row) {
  if (!row || typeof row !== 'object') return;
  if (row.kind === 'request') {
    _metrics.requests += 1;
    if (row.route === 'omniroute') _metrics.omniroute += 1;
    if (row.route === 'direct') _metrics.direct += 1;
    _metrics.last_route = row.route || '';
    _metrics.last_model = (row.after && row.after.model) || (row.before && row.before.model) || '';
  }
  if (row.kind === 'upstream-http-fallback') _metrics.fallback_direct += 1;
  if (row.kind === 'upstream-error' || row.kind === 'request-crash') { _metrics.errors += 1; _metrics.last_error = row.message || row.error_summary || ''; }
  if (row.kind === 'codex-session-reaped') _metrics.duplicate_reaps += row.killed || 0;
}

function guardSession(sessionId) {
  if (!sessionId) return;
  const now = Date.now();
  if (now - _lastGuardMs < 30000) return;
  _lastGuardMs = now;
  try {
    const result = ensureSession(sessionId);
    if (result.killed && result.killed.length) record({ kind: 'codex-session-reaped', session_id: sessionId, killed: result.killed.length, lock_pid: result.lock_pid });
  } catch (err) {
    record({ kind: 'codex-session-guard-error', message: err.message });
  }
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

  function continueAfterTools(index, target, parsed, calls) {
    const depth = target.tool_loop_depth || 0;
    if (!calls.length || depth >= MAX_TOOL_LOOP_DEPTH) return false;
    const results = executeToolCalls(calls, { projectRoot: PROJECT_ROOT, sessionId: source.session_id || '' });
    record({ kind: 'codex-proxy-tool-loop', route: target.kind, depth: depth + 1, calls: results.map((r) => ({ tool: r.name, call_id: r.call_id, is_error: r.is_error })) });
    const nextBody = nextToolRequestBody(target.body, parsed, results);
    attemptTarget(index, { ...target, body: nextBody, tool_loop_depth: depth + 1 });
    return true;
  }

  function sendJsonFinal(target, status, headers, full) {
    const parsed = safeJson(full);
    const calls = extractToolCalls(parsed);
    if (continueAfterTools(target.index, target, parsed, calls)) return;
    const rewritten = parsed && typeof parsed === 'object' ? rewriteCodexResponseObject(parsed) : null;
    if (rewritten && rewritten.stats.unknown_calls) record({ kind: 'codex-unknown-tool-call', route: target.kind, count: rewritten.stats.unknown_calls, names: rewritten.stats.unknown_names || [] });
    const finalBody = rewritten && rewritten.stats.calls ? JSON.stringify(rewritten.body) : full;
    const finalParsed = rewritten ? rewritten.body : parsed;
    if (finalParsed && typeof finalParsed === 'object') planScanner.scanObjectForPlan(finalParsed, source);
    res.writeHead(status, headers);
    res.end(finalBody);
    finishResponse(target, status, '', finalParsed);
  }

  function sendSseFinal(target, status, headers, full) {
    const parsed = parseSseToolCalls(full);
    if (continueAfterTools(target.index, target, { id: parsed.response_id }, parsed.calls)) return;
    const scanner = planScanner.createSseScanner(source);
    scanner.feed(Buffer.from(full));
    scanner.finish();
    res.writeHead(status, headers);
    res.end(full);
    finishResponse(target, status);
  }

  function attemptTarget(index, overrideTarget = null) {
    const target = { ...(overrideTarget || targets[index]), index };
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
      const chunks = [];
      upstreamRes.on('data', (chunk) => chunks.push(chunk));
      upstreamRes.on('end', () => {
        const full = Buffer.concat(chunks).toString('utf8');
        if (contentType.includes('text/event-stream')) sendSseFinal(target, status, headers, full);
        else sendJsonFinal(target, status, headers, full);
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
        res.end(JSON.stringify({ error: 'codex_proxy_upstream_error', message: err.message, upstream: UPSTREAM_URL }));
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
  guardSession(meta.session_id || '');
  const source = { session_id: meta.session_id || '', thread_id: meta.thread_id || '', turn_id: meta.turn_id || '', originator: req.headers.originator || '' };
  if (isSingleQuotaProbe(body)) {
    blockQuotaProbe({ res, payload: body, record, source, component: 'hme-codex-proxy' });
    return;
  }
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
    res.end(JSON.stringify({ status: 'ok', component: 'hme-codex-proxy', version: PROXY_VERSION, git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT, port: PORT, upstream: UPSTREAM_URL, route: targetSummary(targetChain({ model: 'health' }, UPSTREAM_URL, loadConfig)), metrics: _metrics, config: CONFIG_PATH }));
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
  emitStartMarker('codex_proxy', { port: PORT, git: PROXY_GIT_SHA });
  try { const reaped = reapDuplicates(); if (reaped.killed.length) record({ kind: 'codex-session-reaped', killed: reaped.killed.length }); } catch (err) { record({ kind: 'codex-session-guard-error', message: err.message }); }
  record({ kind: 'startup', port: PORT, upstream: UPSTREAM_URL, config: CONFIG_PATH, git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT });
  process.stderr.write(`[codex_proxy] listening on 127.0.0.1:${PORT}, upstream=${UPSTREAM_URL}\n`);
});
