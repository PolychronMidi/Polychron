#!/usr/bin/env node
/**
 * HME inference proxy — Phase 2 of openshell_features_to_mimic.md.
 *
 * Acts as an HTTP chokepoint between Claude Code and the Anthropic API.
 * Claude Code is pointed at http://localhost:9099 via ANTHROPIC_BASE_URL;
 * this daemon forwards every request upstream while inspecting the full
 * conversation for HME-relevant signals and emitting events into
 * metrics/hme-activity.jsonl via the shared emit.py CLI.
 *
 * Responsibilities:
 *   1. Log every inference call (model, message count, tool count, path)
 *   2. Scan the message history for mcp__HME__read tool_use blocks and
 *      compare against write-bearing tool calls (Edit/Write/NotebookEdit,
 *      mcp__HME__edit). Emit coherence_violation when a write occurs in a
 *      conversation that never called HME read first.
 *   3. Pass everything else through unchanged — streaming SSE responses
 *      are piped verbatim so token latency is preserved.
 *
 * Design notes:
 *   - Stateless. No in-memory session map. Each request carries the full
 *     history, so we scan that history rather than maintaining cross-call
 *     state. A restart loses nothing.
 *   - Session identity is a stable hash of the first user message (first
 *     500 chars). Same conversation → same hash.
 *   - No injection into system prompts. Observability only for v1.
 *   - Upstream host/port configurable via env so tests can point at a mock.
 *
 * Env:
 *   HME_PROXY_PORT            default 9099
 *   HME_PROXY_UPSTREAM_HOST   default api.anthropic.com
 *   HME_PROXY_UPSTREAM_PORT   default 443
 *   HME_PROXY_UPSTREAM_TLS    default 1 (set to 0 for plain http upstream)
 *   CLAUDE_PROJECT_DIR        used to resolve tools/HME/activity/emit.py
 *
 * CLI:
 *   node hme_proxy.js         start the proxy
 *   node hme_proxy.js --test  scan stdin payload, print analysis, no listen
 */

'use strict';

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || '/home/jah/Polychron';
const EMIT_PY = path.join(PROJECT_ROOT, 'tools/HME/activity/emit.py');
const PORT = parseInt(process.env.HME_PROXY_PORT || '9099', 10);
const UPSTREAM_HOST = process.env.HME_PROXY_UPSTREAM_HOST || 'api.anthropic.com';
const UPSTREAM_PORT = parseInt(process.env.HME_PROXY_UPSTREAM_PORT || '443', 10);
const UPSTREAM_TLS = (process.env.HME_PROXY_UPSTREAM_TLS ?? '1') !== '0';

const WRITE_INTENT_TOOLS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
  'mcp__HME__edit',
]);
const HME_READ_TOOLS = new Set([
  'mcp__HME__read',
  'mcp__HME__before_editing',
]);

function emit(fields) {
  // Background-fork the Python emitter. If it fails we swallow the error —
  // the activity stream is best-effort observability, never blocking.
  try {
    const args = [EMIT_PY];
    for (const [k, v] of Object.entries(fields)) {
      args.push(`--${k}=${v}`);
    }
    const p = spawn('python3', args, { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
  } catch (_err) {
    // ignore
  }
}

function shortHash(s) {
  let h = 0;
  const n = Math.min(s.length, 500);
  for (let i = 0; i < n; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function sessionKey(payload) {
  const msgs = payload && payload.messages;
  if (!Array.isArray(msgs)) return 'unknown';
  for (const m of msgs) {
    if (m && m.role === 'user') {
      const c = m.content;
      const s = typeof c === 'string' ? c : JSON.stringify(c || '');
      return shortHash(s);
    }
  }
  return 'unknown';
}

function scanMessages(payload) {
  const result = {
    hmeReadCalled: false,
    writeIntentCalled: false,
    toolCalls: [],
    firstWriteBeforeRead: null,
  };
  const msgs = (payload && payload.messages) || [];
  for (const m of msgs) {
    const content = m && m.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const name = block.name || '?';
      result.toolCalls.push(name);
      if (HME_READ_TOOLS.has(name)) {
        result.hmeReadCalled = true;
      }
      if (WRITE_INTENT_TOOLS.has(name)) {
        result.writeIntentCalled = true;
        if (!result.hmeReadCalled && result.firstWriteBeforeRead === null) {
          result.firstWriteBeforeRead = name;
        }
      }
    }
  }
  return result;
}

function handleRequest(clientReq, clientRes) {
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', () => {
    const bodyBuf = Buffer.concat(chunks);
    let payload = null;
    if (bodyBuf.length > 0) {
      try {
        payload = JSON.parse(bodyBuf.toString('utf8'));
      } catch (_err) {
        // non-JSON body — pass through untouched
      }
    }

    if (payload && Array.isArray(payload.messages)) {
      const session = sessionKey(payload);
      const scan = scanMessages(payload);
      emit({
        event: 'inference_call',
        session,
        path: clientReq.url || '?',
        model: (payload.model || 'unknown').replace(/[,=\s]/g, '_'),
        messages: payload.messages.length,
        tool_calls: scan.toolCalls.length,
        hme_read_prior: scan.hmeReadCalled,
        write_intent: scan.writeIntentCalled,
      });
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

    // Forward upstream. Headers are copied verbatim except for `host`, which
    // must be the upstream — we also strip content-length and let Node
    // recompute it since we might re-serialize later (currently we don't).
    const upstreamHeaders = { ...clientReq.headers };
    delete upstreamHeaders.host;
    delete upstreamHeaders['content-length'];
    upstreamHeaders.host = UPSTREAM_HOST;

    const upstreamOpts = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: clientReq.url,
      method: clientReq.method,
      headers: upstreamHeaders,
    };

    const transport = UPSTREAM_TLS ? https : http;
    const upstreamReq = transport.request(upstreamOpts, (upstreamRes) => {
      // Pass through status + headers, then pipe streaming body verbatim.
      // SSE frames from Anthropic flow through without buffering, preserving
      // token latency.
      clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    });

    upstreamReq.on('error', (err) => {
      console.error('[hme-proxy] upstream error:', err.message);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'hme_proxy_upstream', message: err.message },
          }),
        );
      } else {
        clientRes.end();
      }
    });

    if (bodyBuf.length > 0) upstreamReq.write(bodyBuf);
    upstreamReq.end();
  });

  clientReq.on('error', (err) => {
    console.error('[hme-proxy] client error:', err.message);
    try { clientRes.end(); } catch (_e) { /* ignore */ }
  });
}

// ── Test mode ────────────────────────────────────────────────────────────────
// `node hme_proxy.js --test` reads a JSON payload from stdin and prints what
// the proxy would have done: session key, tool scan, violation status. Used
// by unit/smoke tests without spinning up a listener.
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
    const out = {
      session,
      tool_calls: scan.toolCalls,
      hme_read_prior: scan.hmeReadCalled,
      write_intent: scan.writeIntentCalled,
      violation: scan.writeIntentCalled && !scan.hmeReadCalled,
      first_write_before_read: scan.firstWriteBeforeRead,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(out.violation ? 1 : 0);
  });
}

if (process.argv.includes('--test')) {
  runTestMode();
} else {
  const server = http.createServer(handleRequest);
  server.listen(PORT, '127.0.0.1', () => {
    const scheme = UPSTREAM_TLS ? 'https' : 'http';
    console.log(
      `hme-proxy listening on http://127.0.0.1:${PORT} -> ${scheme}://${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
    );
    console.log(`  emit → ${EMIT_PY}`);
    console.log(`  set ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} in Claude Code env`);
  });
  server.on('error', (err) => {
    console.error('[hme-proxy] listen error:', err.message);
    process.exit(1);
  });
}
