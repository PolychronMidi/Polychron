#!/usr/bin/env node
/**
 * HME inference proxy + process supervisor.
 *
 * Single entry point for the entire HME runtime:
 *   - Forwards Claude Code → Anthropic, stripping boilerplate and injecting
 *     jurisdiction context / session status.
 *   - Owns the MCP server and shim as supervised child processes. Claude Code
 *     connects via SSE: ANTHROPIC_BASE_URL=http://127.0.0.1:9099, MCP URL
 *     http://127.0.0.1:9099/mcp. A single pkill -P <pid> kills the whole tree.
 *   - Routes /mcp/* to the supervised MCP HTTP server with per-call timeout
 *     and hang-kill so a stuck tool call never blocks indefinitely.
 *
 * Env:
 *   HME_PROXY_PORT            default 9099
 *   HME_MCP_PORT              default 9098  (internal MCP HTTP server port)
 *   HME_PROXY_UPSTREAM_HOST   default api.anthropic.com
 *   HME_PROXY_UPSTREAM_PORT   default 443
 *   HME_PROXY_UPSTREAM_TLS    default 1 (set to 0 for plain http upstream)
 *   HME_PROXY_INJECT          default 1 (set to 0 for pure observability)
 *   HME_PROXY_SUPERVISE       default 1 (set to 0 to skip child supervision)
 *   PROJECT_ROOT              used to resolve HME tools
 *
 * CLI:
 *   node hme_proxy.js         start the proxy (+ supervise children)
 *   node hme_proxy.js --test  scan stdin payload, print analysis, no listen
 */

'use strict';

const http = require('http');
const https = require('https');

const { sessionKey, emit } = require('./shared');
const {
  resolveUpstream, recordUpstreamSuccess, recordUpstreamFailure,
  DEFAULT_UPSTREAM_HOST, DEFAULT_UPSTREAM_PORT, DEFAULT_UPSTREAM_TLS,
} = require('./upstream');
const { shouldInject, buildStatusContext, buildJurisdictionContext, injectIntoSystem } = require('./context');
const { stripBoilerplate, stripSemanticRedundancy, scanMessages } = require('./messages');

const PORT = parseInt(process.env.HME_PROXY_PORT || '9099', 10);
const SUPERVISE = (process.env.HME_PROXY_SUPERVISE ?? '1') !== '0';
const { MCP_PORT } = require('./supervisor/children');

// ── MCP protocol + supervisor status ─────────────────────────────────────────
const { status: supervisorStatus } = require('./supervisor/index');
const { handleMcpRequest } = require('./mcp_server/index');

// ── Middleware (replaces shell hooks on Claude-native tools) ────────────────
const middleware = require('./middleware/index');
const _loadedMiddleware = middleware.loadAll();
console.log(`[hme-proxy] loaded middleware: ${_loadedMiddleware.join(', ')}`);

function handleRequest(clientReq, clientRes) {
  if (clientReq.url === '/health') {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ status: 'ok', port: PORT, supervisor: supervisorStatus() }));
    return;
  }
  // Route MCP requests to the proxy-native MCP server.
  if (clientReq.url && clientReq.url.startsWith('/mcp')) {
    handleMcpRequest(clientReq, clientRes);
    return;
  }
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', () => {
    const bodyBuf = Buffer.concat(chunks);
    let payload = null;
    if (bodyBuf.length > 0) {
      try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch (_err) { /* pass through */ }
    }

    let outBody = bodyBuf;
    let injected = false;

    const upstream = resolveUpstream(clientReq);
    const isAnthropic = upstream.provider === 'anthropic';

    if (payload && Array.isArray(payload.messages)) {
      const session = sessionKey(payload);

      let bodyDirtiedByStrip = false;
      if (isAnthropic) {
        const b = stripBoilerplate(payload);
        const s = stripSemanticRedundancy(payload);
        if (b > 0 || s > 0) bodyDirtiedByStrip = true;
      }

      let scan = null;
      if (isAnthropic) {
        scan = scanMessages(payload);
        // Run middleware pipeline (activity emission, nexus tracking, log
        // watermark, FAIL scan). Must run AFTER scan so middleware sees the
        // reconciled tool_use/tool_result pairs.
        try {
          middleware.runPipeline(payload, scan, session);
        } catch (err) {
          console.error('[hme-proxy] middleware pipeline error:', err.message);
        }
        if (shouldInject()) {
          const statusBlock = buildStatusContext();
          if (statusBlock) {
            const injectedStatus = injectIntoSystem(payload, statusBlock, 'HME Session Status (proxy-injected)');
            if (injectedStatus) {
              emit({ event: 'status_inject', session });
              bodyDirtiedByStrip = true;
            }
          }
          if (scan.jurisdictionTargets.length > 0) {
            const block = buildJurisdictionContext(scan.jurisdictionTargets);
            injected = injectIntoSystem(payload, block);
            if (injected) {
              emit({
                event: 'jurisdiction_inject',
                session,
                targets: scan.jurisdictionTargets.length,
                first_target: (scan.jurisdictionTargets[0] || '').replace(/[,=\s]/g, '_'),
              });
              bodyDirtiedByStrip = true;
            }
          }
        }
        if (bodyDirtiedByStrip) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        if (scan.writeIntentCalled && !scan.hmeReadCalled) {
          emit({
            event: 'coherence_violation',
            session,
            reason: 'inference_write_without_hme_read',
            tool: scan.firstWriteBeforeRead || '?',
            path: clientReq.url || '?',
            source: 'proxy',
          });
        }
      }

      emit({
        event: 'inference_call',
        session,
        provider: upstream.provider,
        path: clientReq.url || '?',
        model: (payload.model || 'unknown').replace(/[,=\s]/g, '_'),
        messages: payload.messages.length,
        injected: injected,
      });

      if (isAnthropic && injected && scan) {
        emit({
          event: 'injection_influence',
          session,
          injection_type: 'jurisdiction',
          targets_count: scan.jurisdictionTargets.length,
        });
      }
    }

    const upstreamHeaders = { ...clientReq.headers };
    delete upstreamHeaders.host;
    delete upstreamHeaders['content-length'];
    delete upstreamHeaders['x-hme-upstream'];
    upstreamHeaders.host = upstream.host;
    if (outBody.length > 0) upstreamHeaders['content-length'] = String(outBody.length);

    const upstreamPath = (upstream.basePath || '') + clientReq.url;
    const upstreamOpts = {
      hostname: upstream.host,
      port: upstream.port,
      path: upstreamPath,
      method: clientReq.method,
      headers: upstreamHeaders,
    };

    const transport = upstream.tls ? https : http;
    const upstreamReq = transport.request(upstreamOpts, (upstreamRes) => {
      recordUpstreamSuccess();
      clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    });

    const isStreaming = payload && payload.stream === true;
    upstreamReq.setTimeout(isStreaming ? 600_000 : 120_000, () => {
      console.error(`[hme-proxy] upstream timeout (${isStreaming ? 'streaming' : 'sync'})`);
      upstreamReq.destroy(new Error('upstream timeout'));
    });

    upstreamReq.on('error', (err) => {
      console.error('[hme-proxy] upstream error:', err.message);
      recordUpstreamFailure(err.message);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_upstream', message: err.message } }));
      } else {
        clientRes.end();
      }
    });

    if (outBody.length > 0) upstreamReq.write(outBody);
    upstreamReq.end();
  });

  clientReq.on('error', (err) => {
    console.error('[hme-proxy] client error:', err.message);
    try { clientRes.end(); } catch (_e) { /* ignore */ }
  });
}

function runTestMode() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      console.error('test mode: invalid JSON on stdin:', err.message);
      process.exit(2);
    }
    const session = sessionKey(payload);
    const scan = scanMessages(payload);
    const jurisdictionBlock = scan.jurisdictionTargets.length
      ? buildJurisdictionContext(scan.jurisdictionTargets)
      : null;
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

if (process.argv.includes('--test')) {
  runTestMode();
} else {
  if (SUPERVISE) {
    const supervisor = require('./supervisor/index');
    supervisor.start();
  }
  const server = http.createServer(handleRequest);
  server.listen(PORT, '127.0.0.1', () => {
    const scheme = DEFAULT_UPSTREAM_TLS ? 'https' : 'http';
    console.log(`hme-proxy listening on http://127.0.0.1:${PORT}`);
    console.log(`  Anthropic upstream: ${scheme}://${DEFAULT_UPSTREAM_HOST}:${DEFAULT_UPSTREAM_PORT}`);
    console.log(`  MCP upstream: http://127.0.0.1:${MCP_PORT} (supervised, /mcp/* routed here)`);
    if (!SUPERVISE) console.log('  supervision: disabled (HME_PROXY_SUPERVISE=0)');
  });
  server.on('error', (err) => {
    console.error('[hme-proxy] listen error:', err.message);
    process.exit(1);
  });
}
