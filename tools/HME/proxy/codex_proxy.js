#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { loadJsonc } = require('./config_loader');
const { runAutocommit, injectLifesaver } = require('./turn_side_effects');
const { applyRequestTransform } = require('./codex_payload');
const { targetChain, targetSummary } = require('./codex_omniroute');
const { PROJECT_ROOT, RUNTIME_DIR } = require('./shared');
const { requestTelemetry } = require('./request_telemetry');
const { decisionForTarget } = require('./model_route_resolver');
const { servicePort } = require('./service_registry');
const { emitStartMarker } = require('./start_marker');
const { status: codexSessionStatus } = require('./codex_session_guard');
const { isSingleQuotaProbe, blockQuotaProbe } = require('./prompt_spam_guard');
const { createCodexResponseForwarder } = require('./codex_response_forwarder');
const conversationStore = require('./shared/conversation_store');

const PORT = servicePort('codex_proxy');
const PROXY_VERSION = 'hme-codex-proxy/1';
const CONFIG_PATH = process.env.HME_CODEX_PROXY_CONFIG
  || path.join(PROJECT_ROOT, 'tools', 'HME', 'config', 'codex-proxy.json');
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
const _metrics = { requests: 0, omniroute: 0, direct: 0, fallback_direct: 0, errors: 0, duplicate_reaps: 0, history_replays: 0, last_route: null, last_error: '', last_model: '' };

// Per-conversation storage key: use the Codex CLI's own session_id (the UUID
// that `codex --resume <session-id>` resumes against) so each conversation has
function _captureRequestInputItems(body, sessionId) {
  if (!body || !sessionId) return 0;
  if (!Array.isArray(body.input)) return 0;
  return conversationStore.appendItems(sessionId, body.input);
}

function _injectStoredHistory(body, sessionId) {
  if (!body || !sessionId) return 0;
  if (!Array.isArray(body.input)) body.input = body.input == null ? [] : [body.input];
  // Codex CLI resume already sends its persisted rollout context. Replaying our
  // full JSONL store on every resume duplicated hundreds of items and pushed the
  if (body.input.length > 8) return 0;
  const crypto = require('crypto');
  const itemHash = (it) => { try { return crypto.createHash('sha1').update(JSON.stringify(it)).digest('hex').slice(0, 16); } catch (_) { return ''; } };
  let prior = conversationStore.loadHistory(sessionId);
  let fallbackInfo = null;
  if (prior.length === 0) {
    const fallback = conversationStore.loadLatestNonEmptyHistory(sessionId);
    if (fallback.items.length > 0) {
      prior = fallback.items;
      fallbackInfo = { source_session_id: fallback.source_session_id, source_mtime_ms: fallback.source_mtime_ms };
    }
  }
  if (prior.length === 0) return 0;
  const currentHashes = new Set();
  for (const it of body.input) { const h = itemHash(it); if (h) currentHashes.add(h); }
  const priorToInject = prior.filter((it) => { const h = itemHash(it); return h && !currentHashes.has(h); });
  if (priorToInject.length === 0) return 0;
  let insertAt = 0;
  while (insertAt < body.input.length && body.input[insertAt] && body.input[insertAt].role === 'developer') insertAt++;
  body.input = [...body.input.slice(0, insertAt), ...priorToInject, ...body.input.slice(insertAt)];
  _metrics.history_replays += 1;
  if (fallbackInfo) {
    try { fs.appendFileSync(EVENT_LOG, JSON.stringify({ ts: nowIso(), kind: 'codex-history-cross-session-fallback', session_id: sessionId, source: fallbackInfo, items_prepended: priorToInject.length }) + '\n'); }
    catch (_) { /* best-effort telemetry */ }
  }
  return priorToInject.length;
}

function _captureResponseOutputItems(sessionId, outputItems) {
  if (!sessionId || !Array.isArray(outputItems) || outputItems.length === 0) return 0;
  return conversationStore.appendItems(sessionId, outputItems);
}

function loadConfig() {
  if (_config) return _config;
  try {
    _config = loadJsonc(CONFIG_PATH);
  // silent-ok: proxy path logs or preserves raw response; caller keeps explicit status.
  } catch (err) {
    _config = { request_transform: {}, _load_error: err.message };
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

const forwardResponses = createCodexResponseForwarder({
  record,
  projectRoot: PROJECT_ROOT,
  upstreamUrl: UPSTREAM_URL,
  onResponseComplete: _captureResponseOutputItems,
});

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
  // Observe only. Killing duplicate codex wrapper processes from inside the
  // request path can terminate the active interactive TUI as soon as a prompt
  try {
    const result = codexSessionStatus();
    if (result.duplicates && result.duplicates.length) record({ kind: 'codex-session-duplicates-observed', session_id: sessionId, duplicates: result.duplicates.length });
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

async function handleResponses(req, res) {
  const rawBody = await readRequestBody(req, res);
  if (!rawBody) return;
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8') || '{}');
  // silent-ok: proxy path logs or preserves raw response; caller keeps explicit status.
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
  // Conversation continuity: OpenAI Responses API is stateful by design (client
  // chains via previous_response_id, server stores prior turns). When OmniRoute
  _captureRequestInputItems(body, source.session_id);
  const _convoHistoryInjected = _injectStoredHistory(body, source.session_id);
  if (_convoHistoryInjected > 0) record({ kind: 'codex-history-replay', session: source.session_id, items_prepended: _convoHistoryInjected });
  // OmniRoute's codex provider flips body.store=false -> true before forwarding
  // to ChatGPT, which then rejects 400 "Store must be set to false". When the
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'store')) delete body.store;
  const autocommit = runCodexAutocommit();
  const lifesaver = injectCodexLifesaver(body);
  const { body: transformed, before, after, cleanup, payload_log: payloadLog } = applyRequestTransform(lifesaver.body, {
    loadConfig,
    record,
    projectRoot: PROJECT_ROOT,
  });
  const targets = targetChain(transformed, UPSTREAM_URL, loadConfig);
  const route_decision = decisionForTarget({ host: 'codex', protocol: 'openai-responses', requestedModel: transformed.model || body.model || '', target: targets[0] });
  record({
    kind: 'request',
    source,
    upstream: targets[0].url,
    route: targets[0].kind,
    route_decision,
    targets: targetSummary(targets),
    telemetry: requestTelemetry({ host: 'codex', protocol: 'openai-responses', provider: targets[0].kind, route: targets[0].kind, path: req.url, body: transformed, before, after, cleanup, route_decision }),
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
    model: after.model || before.model || '',
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
  record({ kind: 'startup', port: PORT, upstream: UPSTREAM_URL, config: CONFIG_PATH, git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT });
  process.stderr.write(`[codex_proxy] listening on 127.0.0.1:${PORT}, upstream=${UPSTREAM_URL}\n`);
});
