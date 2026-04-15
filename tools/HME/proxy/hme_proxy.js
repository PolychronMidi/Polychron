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
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || '/home/jah/Polychron';
const EMIT_PY = path.join(PROJECT_ROOT, 'tools/HME/activity/emit.py');
const PORT = parseInt(process.env.HME_PROXY_PORT || '9099', 10);
const UPSTREAM_HOST = process.env.HME_PROXY_UPSTREAM_HOST || 'api.anthropic.com';
const UPSTREAM_PORT = parseInt(process.env.HME_PROXY_UPSTREAM_PORT || '443', 10);
const UPSTREAM_TLS = (process.env.HME_PROXY_UPSTREAM_TLS ?? '1') !== '0';
// Injection is on by default; disable with HME_PROXY_INJECT=0 for pure observability.
const INJECT = (process.env.HME_PROXY_INJECT ?? '1') !== '0';

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

// ── Jurisdiction context loading ─────────────────────────────────────────────
// The bias bounds manifest lists 93 locked parameter registrations keyed by
// `module:axis` with the file path that owns each one. We build a
// file → [{key, lo, hi}] map so looking up jurisdiction for a given write
// is O(1). The map is lazily loaded and refreshed at most once per 60s in
// case the manifest is regenerated mid-flight.
const BIAS_MANIFEST = path.join(PROJECT_ROOT, 'scripts/pipeline/bias-bounds-manifest.json');
const STALENESS_PATH = path.join(PROJECT_ROOT, 'metrics/kb-staleness.json');
const JURISDICTION_ZONES = [
  'src/conductor/signal/meta/',
  'src/conductor/signal/profiling/',
];
let _biasByFile = null;
let _biasLoadedAt = 0;
let _stalenessByModule = null;
let _stalenessLoadedAt = 0;
const REFRESH_INTERVAL_MS = 60_000;

function loadBiasManifest() {
  const now = Date.now();
  if (_biasByFile && now - _biasLoadedAt < REFRESH_INTERVAL_MS) return _biasByFile;
  _biasByFile = new Map();
  try {
    const raw = fs.readFileSync(BIAS_MANIFEST, 'utf8');
    const data = JSON.parse(raw);
    const regs = data && data.registrations;
    if (regs && typeof regs === 'object') {
      for (const [key, info] of Object.entries(regs)) {
        if (!info || typeof info !== 'object' || !info.file) continue;
        const arr = _biasByFile.get(info.file) || [];
        arr.push({ key, lo: info.lo, hi: info.hi });
        _biasByFile.set(info.file, arr);
      }
    }
  } catch (_err) {
    // manifest absent or malformed — jurisdiction injection degrades to
    // zone-match only; still usable.
  }
  _biasLoadedAt = now;
  return _biasByFile;
}

function loadStalenessMap() {
  const now = Date.now();
  if (_stalenessByModule && now - _stalenessLoadedAt < REFRESH_INTERVAL_MS) {
    return _stalenessByModule;
  }
  _stalenessByModule = new Map();
  try {
    const raw = fs.readFileSync(STALENESS_PATH, 'utf8');
    const data = JSON.parse(raw);
    for (const m of data.modules || []) {
      if (m.module) _stalenessByModule.set(m.module, m);
    }
  } catch (_err) {
    // staleness index absent — inject without it.
  }
  _stalenessLoadedAt = now;
  return _stalenessByModule;
}

function isJurisdictionFile(filePath) {
  if (!filePath) return false;
  if (JURISDICTION_ZONES.some((z) => filePath.includes(z))) return true;
  const biasMap = loadBiasManifest();
  // Match by tail — the manifest stores "src/..." paths; the Edit tool may
  // pass an absolute path. Compare suffixes.
  for (const manifestPath of biasMap.keys()) {
    if (filePath.endsWith(manifestPath)) return true;
  }
  return false;
}

function buildJurisdictionContext(filePaths) {
  if (!filePaths || filePaths.length === 0) return null;
  const biasMap = loadBiasManifest();
  const staleMap = loadStalenessMap();
  const lines = [];
  let anyMatched = false;
  for (const fp of filePaths) {
    // Normalize to the "src/..." form the manifest uses
    const idx = fp.indexOf('src/');
    const rel = idx >= 0 ? fp.slice(idx) : fp;
    const stem = path.basename(rel, path.extname(rel));
    const bias = biasMap.get(rel) || [];
    const stale = staleMap.get(stem);
    const inZone = JURISDICTION_ZONES.some((z) => rel.includes(z));
    if (!inZone && bias.length === 0 && !stale) continue;
    anyMatched = true;
    lines.push(`### ${rel}`);
    if (inZone) {
      lines.push(`- Zone: hypermeta jurisdiction — controller authority boundary`);
    }
    if (bias.length > 0) {
      lines.push(`- Bias bounds (${bias.length}) — locked by manifest, validated by check-hypermeta-jurisdiction:`);
      for (const b of bias.slice(0, 8)) {
        lines.push(`    ${b.key}: [${b.lo}, ${b.hi}]`);
      }
      if (bias.length > 8) lines.push(`    … (+${bias.length - 8} more)`);
    }
    if (stale) {
      const st = stale.status;
      const days = stale.staleness_days;
      const hits = stale.kb_entries_matched;
      const ds = typeof days === 'number' ? `${days.toFixed(1)}d` : '?';
      lines.push(`- KB status: ${st}  (${hits} entry matches, delta ${ds})`);
    }
    lines.push('');
  }
  if (!anyMatched) return null;
  return [
    '',
    '## HME Jurisdiction Context (proxy-injected)',
    '',
    'Write-bearing tool calls in this turn target files tracked by the hypermeta layer. Before editing, confirm the changes respect the constraints below — check-hypermeta-jurisdiction.js will fail the pipeline otherwise.',
    '',
    ...lines,
    'If any bias bound is stale, re-snapshot with:',
    '  node scripts/pipeline/check-hypermeta-jurisdiction.js --snapshot-bias-bounds',
    '',
  ].join('\n');
}

function injectIntoSystem(payload, jurisdictionBlock) {
  if (!jurisdictionBlock) return false;
  // Anthropic system prompt can be a string OR an array of content blocks.
  if (typeof payload.system === 'string') {
    // Avoid double-injection within the same request shape
    if (payload.system.includes('HME Jurisdiction Context (proxy-injected)')) return false;
    payload.system = payload.system + jurisdictionBlock;
    return true;
  }
  if (Array.isArray(payload.system)) {
    const already = payload.system.some((b) => {
      const t = typeof b === 'string' ? b : b && b.text;
      return typeof t === 'string' && t.includes('HME Jurisdiction Context (proxy-injected)');
    });
    if (already) return false;
    payload.system.push({ type: 'text', text: jurisdictionBlock });
    return true;
  }
  if (payload.system == null) {
    payload.system = jurisdictionBlock;
    return true;
  }
  return false;
}

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
    writeTargets: [],       // file paths from write-intent tool_use inputs
    jurisdictionTargets: [], // subset of writeTargets inside tracked zones
  };
  const msgs = (payload && payload.messages) || [];
  // Only look at the LAST assistant message's tool_use blocks for write
  // targets — that's the "about to be dispatched" turn. Earlier writes in
  // the history already happened and are irrelevant to injection.
  let lastAssistantTools = [];
  for (const m of msgs) {
    const content = m && m.content;
    if (!Array.isArray(content)) continue;
    const toolsInMsg = [];
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
      toolsInMsg.push(block);
    }
    if (m.role === 'assistant' && toolsInMsg.length > 0) {
      lastAssistantTools = toolsInMsg;
    }
  }
  // Extract write targets from the most recent assistant turn
  for (const block of lastAssistantTools) {
    if (!WRITE_INTENT_TOOLS.has(block.name || '?')) continue;
    const input = block.input || {};
    const fp = input.file_path || input.path || input.target || null;
    if (typeof fp === 'string' && fp.length > 0) {
      result.writeTargets.push(fp);
      if (isJurisdictionFile(fp)) {
        result.jurisdictionTargets.push(fp);
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

    let outBody = bodyBuf;
    let injected = false;

    if (payload && Array.isArray(payload.messages)) {
      const session = sessionKey(payload);
      const scan = scanMessages(payload);
      // Real-time jurisdiction injection (Phase 2.1 / feature #1).
      if (INJECT && scan.jurisdictionTargets.length > 0) {
        const block = buildJurisdictionContext(scan.jurisdictionTargets);
        injected = injectIntoSystem(payload, block);
        if (injected) {
          emit({
            event: 'jurisdiction_inject',
            session,
            targets: scan.jurisdictionTargets.length,
            first_target: (scan.jurisdictionTargets[0] || '').replace(/[,=\s]/g, '_'),
          });
          outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        }
      }
      emit({
        event: 'inference_call',
        session,
        path: clientReq.url || '?',
        model: (payload.model || 'unknown').replace(/[,=\s]/g, '_'),
        messages: payload.messages.length,
        tool_calls: scan.toolCalls.length,
        hme_read_prior: scan.hmeReadCalled,
        write_intent: scan.writeIntentCalled,
        jurisdiction_targets: scan.jurisdictionTargets.length,
        injected: injected,
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
    // must be the upstream — we also strip content-length since we may have
    // re-serialized the body (jurisdiction injection).
    const upstreamHeaders = { ...clientReq.headers };
    delete upstreamHeaders.host;
    delete upstreamHeaders['content-length'];
    upstreamHeaders.host = UPSTREAM_HOST;
    if (outBody.length > 0) {
      upstreamHeaders['content-length'] = String(outBody.length);
    }

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

    if (outBody.length > 0) upstreamReq.write(outBody);
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
      jurisdiction_block_preview:
        jurisdictionBlock ? jurisdictionBlock.slice(0, 500) : null,
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
