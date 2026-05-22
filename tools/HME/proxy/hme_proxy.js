#!/usr/bin/env node
/**
 * HME inference proxy + process supervisor.
 *
 * Thin executable wrapper. Core helpers live in hme_proxy_core.js; Claude
 * Anthropic request handling lives in hme_proxy_claude.js; OmniRoute/Codex
 * fallback helpers live in hme_proxy_codex.js.
 */

'use strict';

const http = require('http');
const path = require('path');
const { loadEnv } = require('./shared/load_env');

loadEnv(path.resolve(__dirname, '..', '..', '..', '.env'));

const { sessionKey } = require('./shared');
const {
  DEFAULT_UPSTREAM_HOST, DEFAULT_UPSTREAM_PORT, DEFAULT_UPSTREAM_TLS,
} = require('./upstream');
const {
  buildJurisdictionContext,
  scanMessages,
} = require('./contexts/request_mutation');
const { servicePort } = require('./contexts/upstream_dispatch');
const {
  emitStartMarker,
  supervisor: _supervisorModule,
} = require('./contexts/lifecycle_bridge');
const { createRouteMetrics } = require('./proxy_route_metrics');
const { createContextBudget } = require('./hme_proxy_context_budget');
const { createOpusGate } = require('./hme_proxy_opus_gate');
const core = require('./hme_proxy_core');

// Self-load .env via shared helper; parent shell may not have sourced it.
const PROXY_VERSION = (() => {
  try {
    const p = require('path').resolve(__dirname, '..', 'config', 'versions.json');
    return JSON.parse(require('fs').readFileSync(p, 'utf8')).proxy;
  } catch (_) { return 'unknown'; }
})();
const PROXY_GIT_SHA = (() => {
  try {
    const { runSync } = require('./infra/subprocess');
    const r = runSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: require('path').resolve(__dirname, '..', '..', '..'),
      timeoutMs: 1000,
    });
    return r.exit === 0 ? r.stdout.trim() : 'unknown';
  } catch (_) { return 'unknown'; }
})();
const PROXY_STARTED_AT = new Date().toISOString();
function writeRuntimeMetadata() {
  const { writeMarker } = require('./infra/lifecycle_state');
  writeMarker('PROXY_RUNTIME', { git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT, pid: process.pid });
}
function logRuntimeMetadataFailure(err) {
  try {
    const errLog = require('path').resolve(__dirname, '..', '..', '..', 'log', 'hme-errors.log');
    require('fs').appendFileSync(errLog, `[${new Date().toISOString()}] [proxy-runtime] ERROR failed to write runtime metadata after listen: ${err.message}\n`);
  } catch (_e) { /* silent-ok: alert sink best-effort */ }
}

const proxyRouteMetrics = createRouteMetrics();
const PORT = servicePort('proxy');
const SUPERVISE = (process.env.HME_PROXY_SUPERVISE ?? '1') !== '0';
const { WORKER_PORT } = require('./contexts/lifecycle_bridge').supervisorChildren;

const contextBudget = createContextBudget();
const opusGate = createOpusGate();

let loadedMiddleware = null;
let handleRequest = null;
function getHandleRequest() {
  if (handleRequest) return handleRequest;
  const { middleware } = require('./contexts/request_mutation');
  const { createClaudeHandler } = require('./hme_proxy_claude');
  loadedMiddleware = middleware.loadAll();
  if (process.env.HME_PROXY_QUIET_IMPORT !== '1') console.log(`loaded middleware: ${loadedMiddleware.join(', ')}`);
  handleRequest = createClaudeHandler({
    PORT, PROXY_VERSION, PROXY_GIT_SHA, PROXY_STARTED_AT,
    routeMetrics: proxyRouteMetrics.metrics,
    recordProxyRoute: proxyRouteMetrics.recordRoute,
    recordProxyError: proxyRouteMetrics.recordError,
    WORKER_PORT, SUPERVISE,
    ...contextBudget,
    ...opusGate,
    anthropicTextSseBuffer: core._anthropicTextSseBuffer,
    loadedMiddleware,
  });
  return handleRequest;
}


function runTestMode() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let payload = null;
    try { payload = JSON.parse(raw); }
    catch (err) {
      console.error('test mode: invalid JSON on stdin:', err.message);
      process.exit(2);
    }
    const session = sessionKey(payload);
    const scan = scanMessages(payload);
    const jurisdictionBlock = scan.jurisdictionTargets.length ? buildJurisdictionContext(scan.jurisdictionTargets) : null;
    const out = {
      session,
      tool_calls: scan.toolCalls,
      hme_read_prior: scan.hmeReadCalled,
      write_intent: scan.writeIntentCalled,
      violation: scan.writeIntentCalled && !scan.hmeReadCalled,
      first_write_before_read: scan.firstWriteBeforeRead,
      write_targets: scan.writeTargets,
      jurisdiction_targets: scan.jurisdictionTargets,
      jurisdiction_block_preview: jurisdictionBlock ? jurisdictionBlock.slice(0, 500) : null,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(out.violation ? 1 : 0);
  });
}

if (process.env.HME_PROXY_EXPORT_INTERNALS === '1') {
  module.exports = {
    __hmeProxyInternals: core.__hmeProxyInternals,
    get handleRequest() { return getHandleRequest(); },
  };
} else if (process.argv.includes('--test')) {
  runTestMode();
} else {
  const supervisor = _supervisorModule;
  if (SUPERVISE) supervisor.start();
  else supervisor.installShutdownHandlers();
  const server = http.createServer(getHandleRequest());
  supervisor.registerServer(server);
  let listenFallbackTried = false;
  const announceListen = (hostLabel) => {
    const scheme = DEFAULT_UPSTREAM_TLS ? 'https' : 'http';
    emitStartMarker('hme_proxy', { port: PORT, git: PROXY_GIT_SHA });
    console.log(`hme-proxy listening on ${hostLabel}`);
    console.log(`  Anthropic upstream: ${scheme}://${DEFAULT_UPSTREAM_HOST}:${DEFAULT_UPSTREAM_PORT}`);
    console.log(`  worker upstream: http://127.0.0.1:${WORKER_PORT} (supervised, /mcp/* routed here)`);
    if (!SUPERVISE) console.log('  supervision: disabled (HME_PROXY_SUPERVISE=0)');
  };
  server.on('error', (err) => {
    if (!listenFallbackTried && ['EAFNOSUPPORT', 'EINVAL'].includes(err.code)) {
      listenFallbackTried = true;
      console.warn(`Acceptable warning: listen warning: IPv6 dual-stack unavailable (${err.code}); falling back to 127.0.0.1`);
      server.listen(PORT, '127.0.0.1', () => {
        try { writeRuntimeMetadata(); } catch (metaErr) { logRuntimeMetadataFailure(metaErr); }
        announceListen(`http://127.0.0.1:${PORT}`);
      });
      return;
    }
    proxyRouteMetrics.recordError(err);
    console.error('listen error:', err.message);
    process.exit(1);
  });
  server.listen({ port: PORT, host: '::', ipv6Only: false }, () => {
    try { writeRuntimeMetadata(); } catch (metaErr) { logRuntimeMetadataFailure(metaErr); }
    announceListen(`http://127.0.0.1:${PORT} and http://[::1]:${PORT}`);
  });
}
