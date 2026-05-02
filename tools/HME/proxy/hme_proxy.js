#!/usr/bin/env node
/**
 * HME inference proxy + process supervisor.
 *
 * Single entry point for the entire HME runtime:
 *   - Forwards Claude Code -> Anthropic, stripping boilerplate and injecting
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
  resolveUpstream, recordUpstreamSuccess, recordUpstreamFailure, isPassthroughMode,
  DEFAULT_UPSTREAM_HOST, DEFAULT_UPSTREAM_PORT, DEFAULT_UPSTREAM_TLS,
} = require('./upstream');
const { shouldInject, buildStatusContext, buildJurisdictionContext, injectIntoSystem, stripSystemCacheControl, normalizeCacheControlTtls } = require('./context');
const { stripBoilerplate, stripSemanticRedundancy, scanMessages } = require('./messages');

// Proxy wire-level version. Single source of truth is
// tools/HME/config/versions.json -- bump it to version the three components
// together. A three-way mismatch surfaces via `hme-cli --version`.
const PROXY_VERSION = (() => {
  try {
    const p = require('path').resolve(__dirname, '..', 'config', 'versions.json');
    return JSON.parse(require('fs').readFileSync(p, 'utf8')).proxy;
  } catch (_) { return 'unknown'; }
})();

const PORT = (() => {
  const raw = process.env.HME_PROXY_PORT;
  if (raw == null || raw === '') return 9099;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`HME_PROXY_PORT="${raw}" is not a valid port (0-65535)`);
  }
  return n;
})();
const SUPERVISE = (process.env.HME_PROXY_SUPERVISE ?? '1') !== '0';
const { MCP_PORT } = require('./supervisor/children');

//  MCP protocol + supervisor status
const { status: supervisorStatus } = require('./supervisor/index');
const { handleMcpRequest } = require('./mcp_server/index');

//  Middleware (replaces shell hooks on Claude-native tools)
const middleware = require('./middleware/index');
const _loadedMiddleware = middleware.loadAll();
console.log(`[hme-proxy] loaded middleware: ${_loadedMiddleware.join(', ')}`);

//  Lifecycle hook bridge
// All Claude Code lifecycle events funnel through a SINGLE forwarder script
// (hooks/_proxy_bridge.sh) that POSTs to this proxy's /hme/lifecycle endpoint.
// The proxy dispatches to the appropriate bash hooks and returns {stdout,
// stderr, exit_code} -- the forwarder relays each back to Claude Code's plugin
// machinery, preserving block decisions, banners, and exit codes.
//
// This is the single minimal compromise with Claude Code -- one stateless
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

/**
 * Run an inline fallback dispatch and echo any captured stderr to the
 * proxy's own stderr so the user sees hook banners (sessionstart orientation,
 * LIFESAVER, etc.). Without this the stderr is silently swallowed into
 * dispatchEvent's return value and lost.
 */
async function _runInlineFallback(event, stdinJson) {
  try {
    const r = await hookBridge.dispatchEvent(event, stdinJson);
    // Parity with /hme/lifecycle: both paths surface full stdout/stderr
    // to the proxy's stderr so any banners (LIFESAVER, NEXUS,
    // AUTO-COMPLETENESS) land in the same place regardless of which
    // path fired. Previously the inline path truncated stdout to 200
    // chars -- banners that grew past that limit vanished for inline
    // fires while remaining visible for /hme/lifecycle fires.
    if (r.stderr && r.stderr.length > 0) {
      process.stderr.write(`[hme-proxy] inline ${event} stderr:\n${r.stderr}\n`);
    }
    if (r.stdout && r.stdout.length > 0) {
      process.stderr.write(`[hme-proxy] inline ${event} stdout:\n${r.stdout}\n`);
    }
  } catch (err) {
    console.error(`[hme-proxy] inline ${event} failed: ${err.message}`);
  }
}

// Fire SessionStart inline at startup. If Claude Code hits /hme/lifecycle
// with SessionStart shortly after, we'll note the dup but it's harmless
// (sessionstart.sh is idempotent w.r.t. its state writes).
_runInlineFallback('SessionStart', '{}');

//  HME full-bypass: legacy inline-tool path (disabled by default)
// Claude Code has no MCP connection to us for HME tools (.mcp.json was
// deleted in the MCP decoupling). Two possible Claude-facing surfaces exist:
//   1. DEFAULT: Claude invokes HME via Bash(`npm run <tool>`) -- the npm
//      scripts dispatch to scripts/hme-cli.js -> worker HTTP. Tool injection
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
  // Remove any deprecated mcp__HME__* tools from payload.tools -- they would
  // collide with our proxy-injected HME_ versions on the next step.
  if (Array.isArray(payload.tools)) {
    const before = payload.tools.length;
    payload.tools = payload.tools.filter((t) => !(t && HME_PREFIX.test(t.name || '')));
    if (payload.tools.length !== before) changed = true;
  }
  return changed;
}

// Detect an upstream failure across BOTH error-shape paths Anthropic uses:
//   1. HTTP 4xx/5xx with a JSON error body. Status 429 = overload
//      ("Server is temporarily limiting requests" -- NOT user usage limit).
//      Status 400 = invalid_request_error (cache_control violations etc).
//      Status 401 = auth failure. Status 5xx = server fault.
//   2. HTTP 200 + SSE event stream containing an `event: error` block.
//      Anthropic streams emit validation/runtime errors as SSE events
//      AFTER returning a 200 status, so a status-only check misses them.
// Returns { type, message, requestId } on failure detection, or null when
// the response is a normal success.
// Helper: parse JSON, return null only when input is provably non-JSON;
// any OTHER error (bad encoding, malformed UTF-8) bubbles up unsuppressed.
function _tryParseJson(buf, contextDesc) {
  const text = buf.toString('utf8');
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    // Body LOOKS like JSON (starts with { or [) but doesn't parse. That's
    // a real anomaly worth surfacing -- log it and continue with null so
    // the caller can fall back to plaintext handling without losing the
    // signal entirely. Fail-fast policy: log loudly, don't swallow.
    console.error(`[hme-proxy] _tryParseJson(${contextDesc}): malformed JSON body: ${err.message} -- first 120 chars: ${trimmed.slice(0, 120)}`);
    return null;
  }
}

function _detectUpstreamFailure(status, headers, fullBody) {
  if (status === 429) {
    const retryAfter = headers['retry-after'] || '?';
    const parsed = _tryParseJson(fullBody, 'upstream-429');
    const msg = (parsed && parsed.error && parsed.error.message)
      ? parsed.error.message
      : `overloaded_error (retry-after=${retryAfter}s)`;
    return {
      type: 'overloaded_error',
      message: msg,
      requestId: parsed && parsed.request_id,
      retryAfter,
    };
  }
  if (status >= 400 && status < 600) {
    const parsed = _tryParseJson(fullBody, `upstream-${status}`);
    if (parsed && parsed.error) {
      return {
        type: parsed.error.type || `http_${status}`,
        message: parsed.error.message,
        requestId: parsed.request_id,
      };
    }
    return { type: `http_${status}`, message: fullBody.toString('utf8').slice(0, 500) };
  }
  // SSE error event scan (status 200 + event:error)
  const ct = (headers['content-type'] || '').toLowerCase();
  if (ct.includes('text/event-stream') && fullBody.length > 0) {
    const text = fullBody.toString('utf8');
    const idx = text.indexOf('event: error');
    if (idx >= 0) {
      const dataMatch = text.slice(idx).match(/^data:\s*(\{.*?\})\s*$/m);
      const parsed = dataMatch ? _tryParseJson(Buffer.from(dataMatch[1]), 'sse-error-event') : null;
      if (parsed) {
        const e = parsed.error || parsed;
        return {
          type: e.type || 'sse_error',
          message: e.message,
          requestId: parsed.request_id,
        };
      }
      return { type: 'sse_error', message: 'sse error event with unparseable data' };
    }
  }
  return null;
}

// Per-error-type cooldown to suppress lifesaver/snapshot SPAM when a burst
// of in-flight requests all hit the same upstream failure. Without this, a
// single Anthropic-side 429 storm produced dozens of identical alerts that
// the user had to manually clear. Cooldown is 60s per (type, path_label)
// pair. Snapshots and console logging still fire on every hit; only the
// hme-errors.log lifesaver write and the recordUpstreamFailure call are
// gated. The escape hatch still trips on the FIRST failure as designed.
const _lastAlertAt = new Map(); // key = `${type}|${pathLabel}` -> ms
const _ALERT_COOLDOWN_MS = 60_000;
function _alertCooldownActive(type, pathLabel) {
  const key = `${type}|${pathLabel}`;
  const now = Date.now();
  const last = _lastAlertAt.get(key) || 0;
  if (now - last < _ALERT_COOLDOWN_MS) return true;
  _lastAlertAt.set(key, now);
  return false;
}

// Passthrough-mode emergency compaction: when the escape hatch has tripped,
// drop oldest assistant/user message PAIRS until the serialized payload is
// under a hard byte cap. Anthropic's 429 (TPM) is caused by the *size* of
// the request, not its mutation, so passthrough's "no mutation" pledge
// is useless against this failure mode -- shrink-or-die is the only path.
// Skipped entirely with HME_NO_PASSTHROUGH_COMPACT=1 if the operator
// prefers strict passthrough (and being stuck in 429-loop).
const _PASSTHROUGH_COMPACT_BYTES = 400_000;
const _PASSTHROUGH_COMPACT_KEEP_MIN = 4;

// Dynamic threshold: track the most recent ITPM-remaining from Anthropic
// response headers and shrink the byte budget when we're close to the
// rate-limit ceiling. ~3.5 bytes/token is the rough conversion for
// Claude-Code-shape JSON payloads. Capped to never exceed the static
// _PASSTHROUGH_COMPACT_BYTES; floor at 80 KB so we never over-shrink.
let _lastInputTokensRemaining = null; // updated by response handler
const _BYTES_PER_TOKEN_EST = 3.5;
const _DYNAMIC_THRESHOLD_FLOOR_BYTES = 80_000;
function _effectiveCompactThreshold() {
  if (_lastInputTokensRemaining == null || _lastInputTokensRemaining <= 0) {
    return _PASSTHROUGH_COMPACT_BYTES;
  }
  // Use 70% of remaining-token budget as the byte cap for the next
  // request (leave 30% headroom for the response and other parallel calls).
  const dynamic = Math.floor(_lastInputTokensRemaining * 0.70 * _BYTES_PER_TOKEN_EST);
  const clamped = Math.max(_DYNAMIC_THRESHOLD_FLOOR_BYTES, Math.min(_PASSTHROUGH_COMPACT_BYTES, dynamic));
  return clamped;
}
function _shrinkForPassthrough(payload) {
  if (process.env.HME_NO_PASSTHROUGH_COMPACT === '1') return 0;
  if (!payload || !Array.isArray(payload.messages)) return 0;
  const msgs = payload.messages;
  if (msgs.length <= _PASSTHROUGH_COMPACT_KEEP_MIN) return 0;
  // Dynamic threshold: shrink the byte budget when Anthropic's
  // anthropic-ratelimit-input-tokens-remaining header on the prior
  // response said we're near the cap. Static 400KB is the worst-case
  // ceiling; the dynamic value can be lower.
  const _threshold = _effectiveCompactThreshold();
  let serialized = JSON.stringify(payload);
  if (serialized.length <= _threshold) return 0;

  // TIER 1 -- microcompact: shrink large tool_result blocks in older
  // messages by replacing their content with a short elision marker.
  // This keeps the conversation structure intact (no dropped messages, no
  // orphaned tool_use/tool_result pairs) and is the same approach Claude
  // Code's own internal compaction uses for the cheapest tier. Threshold:
  // any tool_result block over 2 KB in the oldest 70% of messages gets
  // its content replaced; the most recent 30% are preserved verbatim so
  // the model still has full fidelity for recent tool calls.
  const _TOOL_RESULT_BYTE_FLOOR = 2_000;
  const _RECENT_KEEP_FRACTION = 0.30;
  const _recent_start = Math.floor(msgs.length * (1 - _RECENT_KEEP_FRACTION));
  let elided = 0;
  for (let i = 0; i < _recent_start; i++) {
    const m = msgs[i];
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || b.type !== 'tool_result') continue;
      const cstr = typeof b.content === 'string'
        ? b.content
        : (Array.isArray(b.content) ? JSON.stringify(b.content) : '');
      if (cstr.length < _TOOL_RESULT_BYTE_FLOOR) continue;
      b.content = `(content elided by hme-proxy precompact: original was ${cstr.length}B)`;
      elided++;
    }
  }
  if (elided > 0) {
    serialized = JSON.stringify(payload);
    console.error(`[hme-proxy] precompact tier-1 (microcompact): elided ${elided} stale tool_result block(s), body=${serialized.length}B`);
    if (serialized.length <= _threshold) {
      console.error(`[hme-proxy] precompact: tier-1 sufficient, no message drops needed`);
      return elided; // success at tier 1, no dropping required
    }
  }

  // TIER 2 -- summary-via-local-model fallback. Replace the OLDEST half
  // of messages with a single summary text block. Calls llamacpp_daemon
  // (local, no Anthropic API tokens consumed) for the summarization;
  // gated by HME_PROXY_LOCAL_SUMMARY=1 (off by default because it adds
  // latency and a network call to a separate process). When enabled,
  // tier-2 runs BEFORE tier-3 message-drop. Stub: we don't await a real
  // summary -- inserting a marker so the model knows older context was
  // dropped is sufficient for the rate-limit-fix use case. A real
  // summarization call would replace `_summaryText` below.
  if (process.env.HME_PROXY_LOCAL_SUMMARY === '1' && msgs.length > _PASSTHROUGH_COMPACT_KEEP_MIN * 2) {
    const _half = Math.floor(msgs.length / 2);
    const _summaryText = `(hme-proxy local-summary placeholder: ${_half} oldest messages compacted)`;
    msgs.splice(0, _half, { role: 'user', content: _summaryText });
    serialized = JSON.stringify(payload);
    console.error(`[hme-proxy] precompact tier-2 (local-summary): collapsed ${_half} oldest msgs into 1 marker, body=${serialized.length}B`);
    if (serialized.length <= _threshold) return elided + _half;
  }

  // TIER 3 -- session-memory compact: if a pre-extracted session-notes
  // file exists, use it as the summary block instead of summarizing
  // live. Skips the model call entirely. File: tmp/hme-session-notes.txt.
  // Same effect as tier-2 but cheaper (no llamacpp call). Tier-3 supersedes
  // tier-2's marker if both fire.
  try {
    const fsX = require('fs');
    const pathX = require('path');
    const { PROJECT_ROOT } = require('./shared');
    const notesPath = pathX.join(PROJECT_ROOT, 'tmp', 'hme-session-notes.txt');
    if (fsX.existsSync(notesPath) && msgs.length > _PASSTHROUGH_COMPACT_KEEP_MIN * 2) {
      const notes = fsX.readFileSync(notesPath, 'utf8');
      if (notes && notes.length > 0) {
        const _half = Math.floor(msgs.length / 2);
        msgs.splice(0, _half, {
          role: 'user',
          content: `(hme-proxy session-memory compact: ${_half} oldest messages summarized)\n\n${notes.slice(0, 8_000)}`,
        });
        serialized = JSON.stringify(payload);
        console.error(`[hme-proxy] precompact tier-3 (session-memory): used pre-extracted notes (${notes.length}B), body=${serialized.length}B`);
        if (serialized.length <= _threshold) return elided + _half;
      }
    }
  } catch (_e) { /* best-effort */ }

  // TIER 4 -- message-drop fallback. Drop the OLDEST messages until
  // under threshold. Keep at least _PASSTHROUGH_COMPACT_KEEP_MIN. The
  // walk-backward pair-preservation in pass 5 below ensures we don't
  // create orphan tool_use/tool_result pairs across the drop boundary.
  let dropped = 0;
  while (msgs.length > _PASSTHROUGH_COMPACT_KEEP_MIN) {
    msgs.shift();
    dropped++;
    serialized = JSON.stringify(payload);
    if (serialized.length <= _threshold) break;
  }
  // PASS 5 -- walk-backward tool-pair preservation. Anthropic's first-
  // party compaction (per the deep-dive) walks the cut boundary backward
  // to keep tool_use/tool_result pairs together. Our tier-4 dropped from
  // the front; if the FIRST surviving message is a user message with a
  // tool_result whose tool_use is in a dropped assistant message, we
  // need to ALSO drop those tool_results (or extend the cut to also drop
  // the user message). Cheaper than putting the assistant back. We
  // iterate: drop the leading user-tool_result-only message until the
  // first surviving message is clean.
  while (msgs.length > _PASSTHROUGH_COMPACT_KEEP_MIN) {
    const first = msgs[0];
    if (!first || !Array.isArray(first.content)) break;
    const onlyOrphanResults = first.role === 'user'
      && first.content.length > 0
      && first.content.every((b) => b && b.type === 'tool_result');
    if (!onlyOrphanResults) break;
    msgs.shift();
    dropped++;
  }

  // PASS 6 -- residual orphan scrub: any tool_result still present whose
  // tool_use_id isn't in surviving assistant messages gets stripped.
  // Same for orphan tool_use blocks. Empty content arrays after stripping
  // get a placeholder so Anthropic doesn't reject the message for empty
  // content.
  const surviving_use_ids = new Set();
  const surviving_result_ids = new Set();
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use' && b.id) surviving_use_ids.add(b.id);
      if (b.type === 'tool_result' && b.tool_use_id) surviving_result_ids.add(b.tool_use_id);
    }
  }
  let orphans = 0;
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    const before = m.content.length;
    m.content = m.content.filter((b) => {
      if (!b || typeof b !== 'object') return true;
      if (b.type === 'tool_result' && b.tool_use_id && !surviving_use_ids.has(b.tool_use_id)) return false;
      if (b.type === 'tool_use' && b.id && !surviving_result_ids.has(b.id)) return false;
      return true;
    });
    orphans += before - m.content.length;
    if (m.content.length === 0) {
      m.content = [{ type: 'text', text: '(content stripped by hme-proxy passthrough-compact)' }];
    }
  }
  // Insert a synthetic user marker at messages[0] so Anthropic doesn't
  // reject the conversation for starting on assistant. Also gives the
  // model a hint that history was elided.
  if (dropped > 0 && msgs[0] && msgs[0].role === 'assistant') {
    msgs.unshift({
      role: 'user',
      content: `[hme-proxy passthrough-compact: ${dropped} oldest message(s) dropped to fit under TPM rate limit; restart proxy to clear escape-hatch state]`,
    });
  }
  serialized = JSON.stringify(payload);
  console.error(`[hme-proxy] passthrough-compact: dropped ${dropped} oldest messages, scrubbed ${orphans} orphan tool blocks (now ${msgs.length} msgs, body=${serialized.length}B)`);
  return dropped;
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
      // Preserve the turn boundary -- inject a minimal placeholder.
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
    // CACHE FIX: do NOT strip cache_control markers Claude Code attached.
    // Stripping them invalidates Anthropic's prompt cache on every
    // request -- the tools prefix is part of the cache key, and removing
    // the breakpoint tells Anthropic "no cache" for that prefix. The
    // previous comment claimed this prevented a 400 error, but the 400
    // only fires when WE add a ttl=5m marker AFTER a ttl=1h marker
    // Claude Code already placed. Solution: don't add our own markers
    // (we don't need to -- Claude Code's are sufficient), and leave the
    // existing markers alone.
    // [no cache_control mutation here]
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
    // Log receipt so we can verify the forwarder path is active. Fallback
    // callers always run through inline (no POST) so this log existing =
    // Claude Code's hook system is reaching us.
    console.error(`[hme-proxy] /hme/lifecycle received event=${event} (${stdin.length}B)`);
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

    // Discriminator: did the incoming request bring its own auth (= came
    // from Claude Code's interactive path) or did the proxy have to inject
    // OAuth (= came from a loopback sub-pipeline like OVERDRIVE that uses
    // the out-of-band auth-injection path)? Only INTERACTIVE-path
    // failures should trip the escape hatch -- OVERDRIVE's 429s are
    // expected and self-handled by its own circuit breaker, so
    // tripping the global valve on them breaks Claude Code's interactive
    // use as collateral damage. Captured here at request entry so we can
    // tag the response handler later regardless of header mutations.
    const _isInteractivePath = isAnthropic
      && (typeof clientReq.headers['authorization'] === 'string'
          || typeof clientReq.headers['x-api-key'] === 'string');

    // Hoisted session key for telemetry from the upstream response/error
    // callbacks (which run OUTSIDE the `if (payload && messages && !_passthrough)`
    // block where the original `session` was scoped). Reference to undefined
    // `session` was crashing the proxy on every 429 with
    // ReferenceError: session is not defined -> unhandledRejection ->
    // supervisor shutdown -> watchdog respawn loop.
    const _sessionForTelemetry = (payload ? sessionKey(payload) : 'no-payload');

    const _passthrough = isPassthroughMode();
    // Proactive size compaction. Run on EVERY interactive Anthropic
    // request whose serialized body exceeds the TPM-safe threshold,
    // regardless of valve state. Reacting after 429 means the client
    // already ate the failure (Claude Code surfaces the 429 to the user
    // and stops); precompacting prevents the 429 from ever happening.
    // Drops oldest assistant/user messages until the payload fits, then
    // scrubs orphan tool blocks. Disable with HME_NO_PASSTHROUGH_COMPACT=1.
    if (isAnthropic && _isInteractivePath && payload && Array.isArray(payload.messages)) {
      const _dropped = _shrinkForPassthrough(payload);
      if (_dropped > 0) {
        outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        upstreamHeaders['content-length'] = String(outBody.length);
      }
    }

    if (payload && Array.isArray(payload.messages) && !_passthrough) {
      const session = sessionKey(payload);

      let bodyDirtiedByStrip = false;
      if (isAnthropic) {
        // Pre-mutation dump (HME_DUMP_SYSTEM_PROMPT=1): captures Claude
        // Code's pristine outgoing payload before any HME mutation, so the
        // operator can diff against the post-pipeline dump to see exactly
        // what changed. No-op when disabled.
        try {
          require('./middleware/dump_system').writeDump(
            payload, require('./shared').PROJECT_ROOT, 'pre',
            (m) => console.warn('Acceptable warning: [middleware]', m),
          );
        } catch (err) {
          console.error(`[hme-proxy] pre-dump failed: ${err.message}`);
        }
        // Strip system cache_control ONLY when replace_system is going to
        // overwrite payload.system anyway -- otherwise we silently destroy
        // Claude Code's intentional system cache breakpoint and re-bill the
        // entire system prefix every turn. With replace_system enabled the
        // overwrite drops Claude Code's blocks (and their cache_controls)
        // wholesale; the explicit strip is a belt-and-braces no-op there.
        if (process.env.HME_REPLACE_SYSTEM_PROMPT === '1') {
          if (stripSystemCacheControl(payload)) bodyDirtiedByStrip = true;
        }
        const b = stripBoilerplate(payload);
        const s = stripSemanticRedundancy(payload);
        const r = _stripHmePrefixOutgoing(payload);
        // HME tool injection (full bypass) -- await so tools are in payload
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
              _runInlineFallback('UserPromptSubmit', stdin);
            }
          }
        }
        // Run middleware pipeline. Must run AFTER scan so middleware sees the
        // reconciled tool_use/tool_result pairs. Returns true if any
        // middleware mutated the payload (via ctx.markDirty()) -- we need to
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
        // Final-pass cache_control normalization: promote any ttl='5m' (or
        // unspecified-ttl, which defaults to 5m) cache_control on tools or
        // system to ttl='1h'. Eliminates the "1h after 5m" ordering 400 at
        // the source regardless of what Claude Code or any middleware
        // attached upstream. Runs LAST so every preceding mutation is
        // accounted for.
        const ccChanged = normalizeCacheControlTtls(payload);
        if (ccChanged > 0) {
          bodyDirtiedByStrip = true;
          emit({ event: 'cache_control_normalized', session, count: ccChanged });
        }
        if (bodyDirtiedByStrip) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        // inference_write_without_hme_read emission REMOVED.
        // The check was legacy-MCP semantics ("did the agent explicitly
        // invoke HME_read before Edit?"). The current architecture auto-
        // enriches every Edit's result with KB context via edit_context.js
        // and every Read's result with dir-rules + callers + hypotheses
        // via read_context.js / dir_context.js. Any "write without HME
        // read" is therefore inherent to the first edit in a session and
        // transient by design -- not worth emitting 100+ violations/round
        // or aborting the pipeline over.
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

    // Strip accept-encoding to force upstream to respond uncompressed.
    // The proxy mutates SSE bodies via rewriters (ack_strip, run_in_bg
    // rewrite, sleep rewrite) without decompressing first. When Anthropic
    // gzips the response, the rewriter modifies compressed bytes and
    // produces corrupt gzip -- Claude Code's decoder fails with
    // ZlibError, retries (doubling token cost). Forcing uncompressed
    // upstream eliminates the corruption path entirely. Cost: slightly
    // more network bytes localhost<->Anthropic, no token cost change.
    if (isAnthropic) {
      delete upstreamHeaders['accept-encoding'];
    }

    // OAuth Bearer + Claude-Code body-shape fix-up. The public
    // api.anthropic.com OAuth endpoint requires:
    //   1. anthropic-beta = `oauth-2025-04-20`. Claude Code's native
    //      `claude-code-20250908` tag is rejected with 401
    //      "OAuth authentication is currently not supported."
    //      No beta header at all => same 401.
    //   2. payload MUST NOT contain `context_management` (a
    //      Claude-Code-only field). Including it => 400
    //      "context_management: Extra inputs are not permitted".
    // Both verified live with curl against the running proxy on
    // 2026-05-02 -- removing either override breaks subscription auth.
    if (isAnthropic && typeof upstreamHeaders['authorization'] === 'string'
        && upstreamHeaders['authorization'].startsWith('Bearer ')) {
      upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
      if (payload && typeof payload === 'object') {
        const _CC_ONLY_FIELDS = ['context_management'];
        let _stripped = false;
        for (const k of _CC_ONLY_FIELDS) {
          if (k in payload) {
            delete payload[k];
            _stripped = true;
          }
        }
        if (_stripped) {
          outBody = Buffer.from(JSON.stringify(payload), 'utf8');
          upstreamHeaders['content-length'] = String(outBody.length);
        }
      }
    }

    // Out-of-band auth injection. Loopback callers (e.g. the MCP
    // server's overdrive path) POST to the proxy without auth -- they
    // can't forward Claude Code's ambient Authorization header because
    // they aren't in the Claude-Code->proxy request chain. When the
    // incoming request has no auth AND comes from localhost AND the
    // upstream is Anthropic, read the Claude Code OAuth token from
    // ~/.claude/.credentials.json and inject it. Same credential the
    // live Claude Code session uses, same subscription charged. Any
    // other request (non-localhost, non-Anthropic, or already carrying
    // auth) is passed through unchanged.
    if (isAnthropic
        && !upstreamHeaders['authorization']
        && !upstreamHeaders['x-api-key']) {
      const remoteAddr = (clientReq.socket && clientReq.socket.remoteAddress) || '';
      const isLoopback = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
      if (isLoopback) {
        try {
          const credsPath = require('path').join(require('os').homedir(), '.claude/.credentials.json');
          const creds = JSON.parse(require('fs').readFileSync(credsPath, 'utf8'));
          const token = creds && creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
          if (token) {
            upstreamHeaders['authorization'] = `Bearer ${token}`;
            // Match the Bearer fix-up block above: OAuth public endpoint
            // requires this beta tag; no other tag works for /v1/messages.
            if (!upstreamHeaders['anthropic-beta']) {
              upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
            }
            console.error(`[hme-proxy] injected OAuth token for loopback out-of-band request (path=${clientReq.url})`);
          }
        } catch (_err) {
          // Credentials unreadable -- fall through with no auth, upstream
          // will 401 and the caller sees the error. Not silent.
          console.error(`[hme-proxy] auth injection failed: ${_err.message}`);
        }
      }
    }

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
      // Initial-response success/failure determination is DEFERRED until
      // after the full body is buffered (see upstreamRes.on('end') below
      // and _detectUpstreamFailure). This is because Anthropic returns
      // some validation errors as HTTP 200 + SSE error event (not as
      // HTTP 400 with JSON body), and the prior status-code-only check
      // missed those entirely -- so the escape hatch never tripped and
      // the lifesaver banner never got written. The deferred detector
      // covers both shapes.
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
        let fullBody = Buffer.concat(chunks);
        let status = upstreamRes.statusCode || 502;
        let headers = { ...upstreamRes.headers };
        // Capture Anthropic's rate-limit telemetry so the next request's
        // _shrinkForPassthrough can size the byte budget dynamically
        // instead of using the static 400KB ceiling. Header name per
        // https://platform.claude.com/docs/en/api/rate-limits.
        const _hdrTokRemaining = headers['anthropic-ratelimit-input-tokens-remaining'];
        if (_hdrTokRemaining != null) {
          const n = parseInt(_hdrTokRemaining, 10);
          if (Number.isFinite(n) && n >= 0) _lastInputTokensRemaining = n;
        }

        // Detect upstream failure across BOTH paths: HTTP 4xx with JSON
        // error body, AND HTTP 200 with SSE error event in the stream.
        // On detection: trigger escape hatch (threshold=1, so first hit
        // trips), append a LIFESAVER alert with the upstream error text +
        // snapshot the request body. Without the SSE path covered,
        // streaming requests that error out bypassed the hatch entirely.
        const _proxyMutatedBody = isAnthropic && !_passthrough;
        if (_proxyMutatedBody) {
          const _errInfo = _detectUpstreamFailure(status, headers, fullBody);
          if (_errInfo) {
            const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
            const _errMsg = `anthropic ${status} ${_errInfo.type || 'error'} [${_pathLabel}]: ${_errInfo.message || '<no message>'}`;
            const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const _snapshotRel = `tmp/claude-${status}-${_pathLabel}-payload-${_stamp}.json`;
            console.error(`[hme-proxy] UPSTREAM FAILURE detected: ${_errMsg}`);
            // Only the INTERACTIVE-path 4xx/5xx counts as a proxy fault that
            // trips the escape hatch. Sub-pipeline failures (OVERDRIVE,
            // engine_search count_tokens, etc.) are EXPECTED to occasionally
            // 429 and have their own internal circuit breakers; tripping the
            // global valve on them flips ALL future Claude Code requests
            // into passthrough mode -- the very collateral damage the user
            // flagged. We still snapshot + lifesaver-log them so the
            // operator sees them, but we don't kill the interactive path.
            const _coolingDown = _alertCooldownActive(_errInfo.type || `http_${status}`, _pathLabel);
            if (_isInteractivePath && !_coolingDown) {
              recordUpstreamFailure(_errMsg);
            } else if (!_isInteractivePath) {
              console.error(`[hme-proxy] sub-pipeline failure -- NOT tripping escape hatch (interactive path unaffected)`);
            }
            try {
              const fs = require('fs');
              const path = require('path');
              const { PROJECT_ROOT } = require('./shared');
              const outFile = path.join(PROJECT_ROOT, _snapshotRel);
              fs.mkdirSync(path.dirname(outFile), { recursive: true });
              fs.writeFileSync(outFile, outBody);
              fs.writeFileSync(outFile.replace('.json', '.response'), fullBody);
              console.error(`[hme-proxy] payload snapshotted to ${outFile}`);
              if (!_coolingDown) {
                const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
                fs.appendFileSync(errLog,
                  `[${_stamp}] UPSTREAM_${status}_${_pathLabel.toUpperCase()}: ${_errMsg} (request_id=${_errInfo.requestId || '?'}, snapshot=${_snapshotRel})\n`);
              }
            } catch (err) {
              console.error(`[hme-proxy] snapshot/lifesaver write failed: ${err.message}`);
            }
            emit({ event: 'upstream_error', session: _sessionForTelemetry, status, type: _errInfo.type, message: _errInfo.message, path_label: _pathLabel });
          } else {
            recordUpstreamSuccess();
          }
        } else if (status >= 200 && status < 300) {
          recordUpstreamSuccess();
        }

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

        // Strip content-length on ANY SSE-mutation path. Upstream's header
        // advertised the pre-transform byte count; piping through
        // SseTransform (below) changes the body length. Without this
        // strip, clients see a content-length mismatch and can either
        // stall waiting for missing bytes or truncate early. Previously
        // only `final` (continuation) stripped; the transform path
        // silently served a stale length. Peer-review iter 113.
        const _willSseTransform = !final
          && (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
        // Strip stale content-length on EITHER mutation path: SSE transform
        // changes byte count, AND the non-SSE bare-ack-strip rewrite
        // (below) can shrink the body. Without strip, clients see length
        // mismatch and stall or truncate. Cost: chunked encoding.
        if (_willSseTransform || !final) {
          outHeaders = { ...outHeaders };
          delete outHeaders['content-length'];
        }

        clientRes.writeHead(outStatus, outHeaders);

        // Apply SSE transforms only if this is an SSE response being forwarded.
        const isSseFinal = (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
        if (isSseFinal && !final) {
          // Original streaming path (no HME interception happened) -- pipe
          // through the Transform for Bash run_in_background rewriting.
          const { SseTransform } = require('./sse_transform');
          const { runInBackgroundRewrite, longLeadingSleepRewrite, ackStripRewrite } = require('./sse_rewriters');
          // Order matters: longLeadingSleepRewrite rewrites command
          // BEFORE runInBackgroundRewrite reads it on content_block_stop.
          // Both hold state keyed by content-block index in the same
          // ctx map so they see consistent data.
          const xform = new SseTransform({
            rewriters: [longLeadingSleepRewrite, runInBackgroundRewrite, ackStripRewrite],
          });
          // Populate the priorUserWasDeny flag the ack-strip rewriter
          // gates on. Walk request payload's messages to find the latest
          // user message and check if its content matches a hook-deny
          // payload marker.
          try {
            const msgs = (payload && payload.messages) || [];
            let lastUserText = '';
            for (const m of msgs) {
              if (!m || m.role !== 'user') continue;
              const c = m.content;
              if (typeof c === 'string') {
                lastUserText = c;
              } else if (Array.isArray(c)) {
                lastUserText = c.filter((b) => b && b.type === 'text')
                  .map((b) => b.text || '').join(' ') || lastUserText;
              }
            }
            const denyMarkers = [
              'Stop hook feedback:',
              'Stop hook blocking error from command:',
              'AUTO-COMPLETENESS',
              'PreToolUse:',
              'PostToolUse:',
            ];
            const _denyHit = lastUserText && denyMarkers.some((m) => lastUserText.includes(m));
            if (_denyHit) {
              xform._ctx.set('priorUserWasDeny', true);
            }
            // Diagnostic: log every SSE response we set up the strip
            // for, so we can verify the path is being reached and
            // priorUserWasDeny is being set correctly.
            try {
              fs.appendFileSync(
                path.join(PROJECT_ROOT, 'log', 'hme-proxy-ackstrip.log'),
                `[${new Date().toISOString()}] sse-setup priorUserWasDeny=${_denyHit} lastUserHead=${JSON.stringify(lastUserText.slice(0,80))}\n`,
              );
            } catch (_e) { /* best-effort */ }
          } catch (_e) { /* best-effort */ }
          xform.pipe(clientRes);
          xform.end(outBuf);
        } else {
          // Non-streaming path: scan the buffered response body for
          // bare-ack text blocks AND emit a LIFESAVER entry to
          // hme-errors.log every time one is detected. The agent must
          // see this alert next turn so the underlying spam-cause is
          // diagnosed and fixed (per user directive: "make these spam
          // messages raise a lifesaver alert telling you to fix it").
          // The strip itself ALSO runs when conditions match -- defense
          // in depth.
          try {
            const msgs = (payload && payload.messages) || [];
            let lastUserText = '';
            for (const m of msgs) {
              if (!m || m.role !== 'user') continue;
              const c = m.content;
              if (typeof c === 'string') {
                lastUserText = c;
              } else if (Array.isArray(c)) {
                lastUserText = c.filter((b) => b && b.type === 'text')
                  .map((b) => b.text || '').join(' ') || lastUserText;
              }
            }
            const denyMarkers = [
              'Stop hook feedback:',
              'Stop hook blocking error from command:',
              'AUTO-COMPLETENESS',
              'PreToolUse:',
              'PostToolUse:',
            ];
            const userIsDeny = lastUserText && denyMarkers.some((m) => lastUserText.includes(m));
            const outStr = outBuf.toString('utf8');
            if (outStr.trimStart().startsWith('{')) {
              const parsed = JSON.parse(outStr);
              if (parsed && Array.isArray(parsed.content)) {
                // Use the canonical ack detector from sse_rewriters so the
                // SSE and non-SSE paths stay in sync. Keyword templates
                // PLUS minimal/punctuation-only/empty fall under one
                // _isBareAck function.
                const { _isBareAck } = require('./sse_rewriters');
                let detectedAck = false;
                for (const b of parsed.content) {
                  if (b && b.type === 'text' && typeof b.text === 'string'
                      && _isBareAck(b.text)) {
                    detectedAck = true;
                    break;
                  }
                }
                if (detectedAck) {
                  // Always-emit LIFESAVER alert -- regardless of whether
                  // the strip succeeded. The agent must SEE the alert.
                  try {
                    const _logTs = new Date().toISOString();
                    const _ackContext = userIsDeny ? 'cascade-after-deny' : 'cascade-no-deny';
                    fs.appendFileSync(
                      path.join(PROJECT_ROOT, 'log', 'hme-errors.log'),
                      `[${_logTs}] [bare-ack-spam] agent emitted bare-ack response (${_ackContext}); diagnose and fix the underlying detector cascade -- this is the spam pattern the user explicitly flagged\n`,
                    );
                  } catch (_e2) { /* alert is best-effort */ }
                  if (userIsDeny) {
                    parsed.content = parsed.content.filter((b) => {
                      if (!b || b.type !== 'text' || typeof b.text !== 'string') return true;
                      return !_isBareAck(b.text);
                    });
                    const newBuf = Buffer.from(JSON.stringify(parsed), 'utf8');
                    clientRes.end(newBuf);
                    return;
                  }
                }
              }
            }
          } catch (_e) { /* best-effort -- fall through to verbatim */ }
          clientRes.end(outBuf);
        }
        // Lifecycle: fire stop hook (auto-commit + lifecycle checks) as
        // fallback when Claude Code's hook system isn't reaching the
        // /hme/lifecycle endpoint. Runs AFTER the response has been sent
        // to the client so commit latency doesn't affect user-visible
        // turn end. No-op if a recent /hme/lifecycle Stop hit was received.
        //
        // Turn-end heuristic: a single user turn can issue many upstream
        // completions (tool-use continuation loops, subagent dispatches).
        // Without this check the Stop fallback fires on EVERY completion
        // whose response lands >=30s after the last Stop hit, re-running
        // auto-commit + LIFESAVER + psycho_stop mid-turn. We only fire
        // when the final assistant message contains no tool_use blocks
        // (i.e. the model is not about to call another tool) -- that
        // approximates "real turn end" without needing stream-end
        // signaling from Claude Code.
        const _hasToolUse = (() => {
          try {
            // For non-streaming responses outBuf is a JSON message with
            // .content (array of blocks). SSE streams collect deltas
            // upstream into `final`; we don't need this path for those
            // because streaming tool-use completions typically route
            // through the continuation loop. Safe default on parse
            // failure: treat as no-tool-use so the fallback still fires
            // when we genuinely can't tell (rare).
            const outStr = (outBuf && typeof outBuf.toString === 'function')
              ? outBuf.toString('utf8') : '';
            if (!outStr || !outStr.trimStart().startsWith('{')) return false;
            const parsed = JSON.parse(outStr);
            if (!parsed || !Array.isArray(parsed.content)) return false;
            for (const b of parsed.content) {
              if (b && b.type === 'tool_use') return true;
            }
            return false;
          } catch (_) { return false; }
        })();
        if (isAnthropic && !_hasToolUse && _lifecycleInactive('Stop')) {
          try {
            const stopSession = payload ? sessionKey(payload) : 'unknown';
            const stdin = JSON.stringify({ session_id: stopSession, transcript_path: '' });
            _runInlineFallback('Stop', stdin);
          } catch (e) {
            console.error('[hme-proxy] inline Stop threw:', e.message);
          }
        }
      });
      upstreamRes.on('error', (err) => {
        // Mid-response failures (connection reset while streaming, TLS
        // mid-frame, etc). Same lifesaver discipline as the connection-
        // time and response-complete error paths.
        const _errCode = err.code || 'mid_response';
        const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
        const _errMsg = `upstream ${_errCode} mid-response [${_pathLabel}]: ${err.message}`;
        console.error(`[hme-proxy] upstream read error: ${_errMsg}`);
        if (_isInteractivePath) {
          recordUpstreamFailure(_errMsg);
        }
        try {
          const fs = require('fs');
          const path = require('path');
          const { PROJECT_ROOT } = require('./shared');
          const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
          fs.appendFileSync(errLog,
            `[${_stamp}] UPSTREAM_${_errCode}_${_pathLabel.toUpperCase()}_MIDRESPONSE: ${_errMsg}\n`);
        } catch (_e) { /* lifesaver write best-effort; the console log above already surfaced it */ }
        emit({ event: 'upstream_midresponse_error', code: _errCode, message: err.message, path_label: _pathLabel });
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_upstream_midresponse', code: _errCode, message: err.message } }));
        } else {
          clientRes.end();
        }
      });
    });

    const isStreaming = payload && payload.stream === true;
    // 30-min unified upstream timeout. Was 120s sync / 600s streaming;
    // 600s sync still tripped the emergency valve under load when
    // `claude --resume` calls on multi-MB transcripts hit Anthropic's
    // API. A 22MB transcript needs even longer than 600s for first
    // byte under contention. The request budget IS bounded by claude's
    // own subprocess timeout (computed dynamically in
    // buddy_handoff.py:cmd_consult, max(1800, transcript_mb * 30 + 600)),
    // so the proxy's role is NOT to be the tighter bound -- a truly
    // hung call dies at the claude-subprocess level. 30 min covers
    // Anthropic's worst-case turnaround on multi-MB resumes plus a
    // safety margin; smaller prompts complete in seconds and aren't
    // affected.
    const UPSTREAM_TIMEOUT_MS = 1_800_000;
    upstreamReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      console.error(`[hme-proxy] upstream timeout (${isStreaming ? 'streaming' : 'sync'})`);
      upstreamReq.destroy(new Error('upstream timeout'));
    });

    upstreamReq.on('error', (err) => {
      // Connection-level failures: ECONNRESET, ECONNREFUSED, ETIMEDOUT,
      // EAI_AGAIN, TLS handshake failures. Same lifesaver/snapshot
      // discipline as the response-time detector so the user sees what
      // happened in the next prompt instead of staring at a generic 502.
      const _errCode = err.code || 'unknown';
      const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
      const _errMsg = `upstream ${_errCode} [${_pathLabel}]: ${err.message}`;
      console.error(`[hme-proxy] upstream connection error: ${_errMsg}`);
      if (_isInteractivePath) {
        recordUpstreamFailure(_errMsg);
      } else {
        console.error('[hme-proxy] sub-pipeline conn-error -- NOT tripping escape hatch');
      }
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('./shared');
        const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const _snapshotRel = `tmp/claude-${_errCode}-${_pathLabel}-payload-${_stamp}.json`;
        const outFile = path.join(PROJECT_ROOT, _snapshotRel);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, outBody);
        const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
        fs.appendFileSync(errLog,
          `[${_stamp}] UPSTREAM_${_errCode}_${_pathLabel.toUpperCase()}: ${_errMsg} (snapshot=${_snapshotRel})\n`);
      } catch (snapErr) {
        console.error(`[hme-proxy] conn-error snapshot/lifesaver write failed: ${snapErr.message}`);
      }
      emit({ event: 'upstream_conn_error', code: _errCode, message: err.message, path_label: _pathLabel });
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_upstream', code: _errCode, message: err.message } }));
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
  // Always require supervisor -- its signal handlers (SIGHUP, uncaughtException,
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
