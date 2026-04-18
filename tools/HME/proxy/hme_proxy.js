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
const { shouldInject, buildStatusContext, buildJurisdictionContext, injectIntoSystem, stripSystemCacheControl } = require('./context');
const { stripBoilerplate, stripSemanticRedundancy, scanMessages } = require('./messages');

// Proxy wire-level version. Single source of truth is
// tools/HME/config/versions.json — bump it to version the three components
// together. A three-way mismatch surfaces via `hme-cli --version`.
const PROXY_VERSION = (() => {
  try {
    const p = require('path').resolve(__dirname, '..', 'config', 'versions.json');
    return JSON.parse(require('fs').readFileSync(p, 'utf8')).proxy;
  } catch (_) { return 'unknown'; }
})();

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

// ── Lifecycle hook bridge ─────────────────────────────────────────────────
// All Claude Code lifecycle events funnel through a SINGLE forwarder script
// (hooks/_proxy_bridge.sh) that POSTs to this proxy's /hme/lifecycle endpoint.
// The proxy dispatches to the appropriate bash hooks and returns {stdout,
// stderr, exit_code} — the forwarder relays each back to Claude Code's plugin
// machinery, preserving block decisions, banners, and exit codes.
//
// This is the single minimal compromise with Claude Code — one stateless
// 10-line bash script Claude Code is allowed to know about; all logic lives
// here in proxy-land.
//
// Fallback: inline fires for SessionStart/UserPromptSubmit/Stop also run
// when the forwarder-based path isn't reaching us (Claude Code plugin cache
// missing, forwarder not installed, etc.). Tracked via _lifecycleSeen so
// we don't double-fire once Claude Code's hook system is active.
const hookBridge = require('./hook_bridge');
const _lifecycleSeen = { SessionStart: 0, UserPromptSubmit: 0, Stop: 0 };
const _LIFECYCLE_FRESH_MS = 30_000;
function _recordLifecycleHit(event) { _lifecycleSeen[event] = Date.now(); }
function _lifecycleInactive(event) {
  const last = _lifecycleSeen[event] || 0;
  return (Date.now() - last) > _LIFECYCLE_FRESH_MS;
}
// Fire SessionStart inline at startup. If Claude Code hits /hme/lifecycle
// with SessionStart shortly after, we'll note the dup but it's harmless
// (sessionstart.sh is idempotent w.r.t. its state writes).
hookBridge.dispatchEvent('SessionStart', '{}').catch((err) => {
  console.error('[hme-proxy] inline SessionStart failed:', err.message);
});

// ── HME full-bypass: legacy inline-tool path (disabled by default) ──────────
// Claude Code has no MCP connection to us for HME tools (.mcp.json was
// deleted in the MCP decoupling). Two possible Claude-facing surfaces exist:
//   1. DEFAULT: Claude invokes HME via Bash(`npm run <tool>`) — the npm
//      scripts dispatch to scripts/hme-cli.js → worker HTTP. Tool injection
//      below is skipped.
//   2. LEGACY (opt-in, HME_INJECT_TOOLS=1): the proxy injects HME tool
//      schemas into payload.tools; when the response contains HME_* tool_uses,
//      the dispatcher runs them via the worker and continues the conversation.
// See hme_dispatcher.js for the legacy path.
const hmeDispatcher = require('./hme_dispatcher');

const HME_PREFIX = /^mcp__HME__/;
function _stripHmePrefixOutgoing(payload) {
  // Backward-compat: message histories may still contain mcp__HME__ tool_uses
  // from prior sessions. Rename to HME_ so the model sees a consistent name.
  let changed = false;
  const rename = (name) => {
    if (typeof name !== 'string') return name;
    if (!HME_PREFIX.test(name)) return name;
    changed = true;
    return name.replace(HME_PREFIX, 'HME_');
  };
  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      if (!msg || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block && block.type === 'tool_use') block.name = rename(block.name);
      }
    }
  }
  // Remove any deprecated mcp__HME__* tools from payload.tools — they would
  // collide with our proxy-injected HME_ versions on the next step.
  if (Array.isArray(payload.tools)) {
    const before = payload.tools.length;
    payload.tools = payload.tools.filter((t) => !(t && HME_PREFIX.test(t.name || '')));
    if (payload.tools.length !== before) changed = true;
  }
  return changed;
}

function _sanitizePayload(payload) {
  // Remove empty text blocks left behind by regex-based strips. Anthropic's
  // /v1/messages rejects them with 400 "text content blocks must be non-empty".
  if (!Array.isArray(payload.messages)) return;
  for (const msg of payload.messages) {
    if (!msg || !Array.isArray(msg.content)) continue;
    msg.content = msg.content.filter((b) => {
      if (!b) return false;
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim().length === 0) return false;
      return true;
    });
    if (msg.content.length === 0) {
      // Preserve the turn boundary — inject a minimal placeholder.
      msg.content = [{ type: 'text', text: '(content stripped by hme-proxy)' }];
    }
  }
}

async function _injectHmeTools(payload) {
  // HME tools are invoked as Bash(`npm run <tool>`) calls; inline API-tool
  // injection is disabled by default. Set HME_INJECT_TOOLS=1 in .env to
  // restore the old path (Claude sees HME_* as inline tools directly).
  if (process.env.HME_INJECT_TOOLS !== '1') return 0;
  if (!Array.isArray(payload.tools)) payload.tools = [];
  try {
    const schemas = await hmeDispatcher.getSchemasCached();
    // Strip any cache_control markers from the tools array — Claude Code may
    // put ttl='1h' markers on messages, and adding ttl='5m' (ephemeral) to
    // tools triggers a 400: "ttl='1h' block must not come after ttl='5m' block"
    // since tools are processed before messages. Leave cache_control entirely
    // to Claude Code; don't add our own markers.
    for (const t of payload.tools) {
      if (t && t.cache_control) delete t.cache_control;
    }
    // Skip any HME_ tool that's already present (idempotent on retries).
    const existing = new Set(payload.tools.map((t) => t && t.name).filter(Boolean));
    let injected = 0;
    for (const s of schemas) {
      if (!existing.has(s.name)) { payload.tools.push({ ...s }); injected++; }
    }
    return injected;
  } catch (err) {
    console.error(`[hme-proxy] HME tool injection failed: ${err.message}`);
    return 0;
  }
}

function _handleSpawnRoute(clientReq, clientRes) {
  const supervisor = require('./supervisor/index');
  const [rawPath] = (clientReq.url || '').split('?');
  const parts = rawPath.split('/').filter(Boolean);  // ['hme', 'spawn', <id>?]
  const spawnId = parts[2] || null;

  const json = (status, body) => {
    clientRes.writeHead(status, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify(body));
  };

  if (clientReq.method === 'GET' && !spawnId) return json(200, { processes: supervisor.adhocList() });
  if (clientReq.method === 'GET' && spawnId) {
    const s = supervisor.adhocStatus(spawnId);
    return s ? json(200, s) : json(404, { error: 'unknown spawn id' });
  }
  if (clientReq.method === 'DELETE' && spawnId) {
    const ok = supervisor.adhocKill(spawnId, 'SIGTERM');
    return json(ok ? 200 : 404, { id: spawnId, killed: ok });
  }
  if (clientReq.method === 'POST' && !spawnId) {
    const chunks = [];
    clientReq.on('data', (c) => chunks.push(c));
    clientReq.on('end', () => {
      let spec;
      try { spec = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch (err) { return json(400, { error: 'bad JSON: ' + err.message }); }
      if (!spec.cmd) return json(400, { error: 'missing required field: cmd' });
      try {
        const result = supervisor.adhocSpawn(spec);
        return json(200, result);
      } catch (err) {
        return json(500, { error: err.message });
      }
    });
    return;
  }
  json(405, { error: 'method not allowed' });
}

/**
 * Lifecycle bridge route. One forwarder script POSTs here with:
 *   - query ?event=<EventName>
 *   - body = the Claude Code hook stdin JSON payload
 * We dispatch to the appropriate bash hook chain and respond with JSON:
 *   {stdout: "...", stderr: "...", exit_code: <int>}
 * The forwarder script relays each field back to Claude Code's plugin
 * machinery, preserving block decisions, banners, and exit codes.
 */
function _handleLifecycleRoute(clientReq, clientRes) {
  const json = (status, body) => {
    clientRes.writeHead(status, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify(body));
  };
  if (clientReq.method !== 'POST') return json(405, { error: 'POST only' });
  const url = new URL(clientReq.url, 'http://127.0.0.1');
  const event = url.searchParams.get('event') || '';
  if (!event) return json(400, { error: 'missing ?event=<EventName>' });
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', async () => {
    const stdin = Buffer.concat(chunks).toString('utf8') || '{}';
    // Mark Claude Code's hook system as active for this event so inline
    // fallback fires don't double-invoke it.
    _recordLifecycleHit(event);
    try {
      const result = await hookBridge.dispatchEvent(event, stdin);
      json(200, result);
    } catch (err) {
      console.error(`[hme-proxy] lifecycle dispatch threw: ${err.message}`);
      json(500, { stdout: '', stderr: `dispatch error: ${err.message}`, exit_code: -1 });
    }
  });
  clientReq.on('error', (err) => {
    if (!clientRes.headersSent) json(500, { error: err.message });
  });
}

function _handleChatRoute(clientReq, clientRes) {
  const workerPath = (clientReq.url || '').replace(/^\/chat/, '') || '/';
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...clientReq.headers };
    delete headers.host;
    if (body.length > 0) headers['content-length'] = String(body.length);
    const opts = {
      hostname: '127.0.0.1', port: MCP_PORT,
      path: workerPath, method: clientReq.method, headers,
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(clientRes);
    });
    proxyReq.on('error', (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ error: err.message }));
      } else {
        clientRes.end();
      }
    });
    proxyReq.setTimeout(60_000, () => proxyReq.destroy(new Error('chat proxy timeout')));
    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
  clientReq.on('error', () => { try { clientRes.end(); } catch (_e) { /* ignore */ } });
}

function handleRequest(clientReq, clientRes) {
  if (clientReq.url === '/health') {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({
      status: 'ok', port: PORT, version: PROXY_VERSION, supervisor: supervisorStatus(),
    }));
    return;
  }
  if (clientReq.url === '/version') {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ version: PROXY_VERSION, component: 'hme-proxy' }));
    return;
  }
  // Ad-hoc spawn API: POST /hme/spawn, GET /hme/spawn, GET/DELETE /hme/spawn/<id>
  if (clientReq.url && clientReq.url.startsWith('/hme/spawn')) {
    _handleSpawnRoute(clientReq, clientRes);
    return;
  }
  // Lifecycle bridge: the single forwarder script (hooks/_proxy_bridge.sh)
  // POSTs every Claude Code lifecycle event here. We dispatch to bash hooks
  // and return {stdout, stderr, exit_code} for the forwarder to relay.
  if (clientReq.url && clientReq.url.startsWith('/hme/lifecycle')) {
    _handleLifecycleRoute(clientReq, clientRes);
    return;
  }
  // Route MCP requests to the proxy-native MCP server.
  if (clientReq.url && clientReq.url.startsWith('/mcp')) {
    handleMcpRequest(clientReq, clientRes);
    return;
  }
  // Route /chat/* to the worker shim (strips /chat prefix).
  if (clientReq.url && clientReq.url.startsWith('/chat')) {
    _handleChatRoute(clientReq, clientRes);
    return;
  }
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', async () => {
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
        // Scrub any cache_control from system blocks — old proxy versions added
        // them, and stale markers in conversation history cause Anthropic 400
        // TTL ordering errors. Must run before any system mutation.
        if (stripSystemCacheControl(payload)) bodyDirtiedByStrip = true;
        const b = stripBoilerplate(payload);
        const s = stripSemanticRedundancy(payload);
        const r = _stripHmePrefixOutgoing(payload);
        // HME tool injection (full bypass) — await so tools are in payload
        // before we serialize and forward upstream.
        const n = await _injectHmeTools(payload);
        // Safety: any strip above may have reduced a text block to an empty
        // string. Anthropic rejects empty text content with HTTP 400
        // ("messages: text content blocks must be non-empty"). Drop empty
        // text blocks; if a message ends up content-less, inject a minimal
        // placeholder so the topology survives.
        _sanitizePayload(payload);
        if (b > 0 || s > 0 || r || n > 0) bodyDirtiedByStrip = true;
      }

      let scan = null;
      if (isAnthropic) {
        scan = scanMessages(payload);
        // Inline fallback for UserPromptSubmit when Claude Code's hook system
        // isn't reaching the /hme/lifecycle endpoint (plugin cache missing,
        // forwarder not installed, etc.). No-op if a recent /hme/lifecycle
        // UserPromptSubmit hit was received.
        if (_lifecycleInactive('UserPromptSubmit')) {
          const last = payload && Array.isArray(payload.messages)
            ? payload.messages[payload.messages.length - 1] : null;
          if (last && last.role === 'user') {
            let promptText = '';
            if (typeof last.content === 'string') promptText = last.content;
            else if (Array.isArray(last.content)) {
              promptText = last.content
                .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text).join('\n');
            }
            if (promptText) {
              const stdin = JSON.stringify({ user_prompt: promptText, session_id: session });
              hookBridge.dispatchEvent('UserPromptSubmit', stdin).catch((err) => {
                console.error('[hme-proxy] inline UserPromptSubmit failed:', err.message);
              });
            }
          }
        }
        // Run middleware pipeline. Must run AFTER scan so middleware sees the
        // reconciled tool_use/tool_result pairs. Returns true if any
        // middleware mutated the payload (via ctx.markDirty()) — we need to
        // re-serialize before forwarding.
        try {
          const mwDirtied = await middleware.runPipeline(payload, scan, session);
          if (mwDirtied) bodyDirtiedByStrip = true;
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
      const ct = (upstreamRes.headers['content-type'] || '').toLowerCase();
      const isSse = isAnthropic && ct.includes('text/event-stream');

      if (!isAnthropic) {
        // Non-Anthropic providers: pipe verbatim, no transforms.
        clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
        return;
      }

      // Anthropic path: buffer the entire response so we can scan for HME_*
      // tool_uses. If none present, forward buffer + apply SSE transforms
      // (Bash run_in_background rewrite). If HME_* present, run the
      // continuation loop until a final HME-free response, then forward it.
      const chunks = [];
      upstreamRes.on('data', (c) => chunks.push(c));
      upstreamRes.on('end', async () => {
        const fullBody = Buffer.concat(chunks);
        const status = upstreamRes.statusCode || 502;
        const headers = { ...upstreamRes.headers };

        let final = null;
        if (status >= 200 && status < 300 && payload) {
          try {
            final = await hmeDispatcher.maybeHandleHme(
              fullBody, headers, status, payload,
              { host: upstream.host, port: upstream.port, tls: upstream.tls,
                path: upstreamPath, method: 'POST', headers: upstreamHeaders },
              isSse,
            );
          } catch (err) {
            console.error('[hme-proxy] HME continuation failed:', err.message);
          }
        }

        let outStatus = status;
        let outHeaders = headers;
        let outBuf = fullBody;
        if (final) {
          outStatus = final.finalStatus;
          outHeaders = { ...final.finalHeaders };
          outBuf = final.finalBody;
          emit({ event: 'hme_continuation_complete', loops: final.loops, bytes: outBuf.length });
          // Continuation loop runs stream:false. Normalize headers.
          delete outHeaders['content-length'];
        }

        clientRes.writeHead(outStatus, outHeaders);

        // Apply SSE transforms only if this is an SSE response being forwarded.
        const isSseFinal = (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
        if (isSseFinal && !final) {
          // Original streaming path (no HME interception happened) — pipe
          // through the Transform for Bash run_in_background rewriting.
          const { SseTransform } = require('./sse_transform');
          const { runInBackgroundRewrite } = require('./sse_rewriters');
          const xform = new SseTransform({ rewriters: [runInBackgroundRewrite] });
          xform.pipe(clientRes);
          xform.end(outBuf);
        } else {
          clientRes.end(outBuf);
        }
        // Lifecycle: fire stop hook (auto-commit + lifecycle checks). Runs
        // after response has been sent to the client so commit latency
        // doesn't affect user-visible turn end. Fire-and-forget (detached).
        // `session` from line 277 is out of scope here — recompute from
        // payload, falling back to 'unknown' if payload is absent.
      });
      upstreamRes.on('error', (err) => {
        console.error('[hme-proxy] upstream read error:', err.message);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({ type: 'error', error: { message: err.message } }));
        } else {
          clientRes.end();
        }
      });
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
  // Always require supervisor — its signal handlers (SIGHUP, uncaughtException,
  // etc.) are load-bearing even when SUPERVISE=0. Only the child-start sequence
  // is gated behind SUPERVISE.
  const supervisor = require('./supervisor/index');
  if (SUPERVISE) {
    supervisor.start();
  } else {
    supervisor.installShutdownHandlers();
  }
  const server = http.createServer(handleRequest);
  supervisor.registerServer(server);  // enables graceful drain on shutdown
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
