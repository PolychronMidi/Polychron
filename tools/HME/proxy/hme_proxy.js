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
  refreshOauthToken,
  DEFAULT_UPSTREAM_HOST, DEFAULT_UPSTREAM_PORT, DEFAULT_UPSTREAM_TLS,
} = require('./upstream');
const { shouldInject, buildStatusContext, consumeStatusContext, buildJurisdictionContext, injectIntoSystem, injectIntoLastUserMessage, stripSystemCacheControl, normalizeCacheControlTtls } = require('./context');
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

// Build identity in /health -- "is my new code live?" was unanswerable
// from the wire previously. PROXY_VERSION is hand-bumped and stale
// across most edits. Captured ONCE at module load so a long-running
// proxy reports the SHA + start time it actually booted with.
const PROXY_GIT_SHA = (() => {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', {
      cwd: require('path').resolve(__dirname, '..', '..', '..'),
      encoding: 'utf8',
      timeout: 1000,
    }).trim();
  } catch (_) { return 'unknown'; }
})();
const PROXY_STARTED_AT = new Date().toISOString();

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
// Lifecycle bridge moved to lifecycle_bridge.js. Side-effect-on-load:
// firing SessionStart inline still happens once at module-require time
// inside lifecycle_bridge.js, preserving the original startup behavior.
const {
  recordLifecycleHit: _recordLifecycleHit,
  lifecycleInactive: _lifecycleInactive,
  runInlineFallback: _runInlineFallback,
  handleLifecycleRoute: _handleLifecycleRoute,
} = require('./lifecycle_bridge');
// handleSpawnRoute extracted to routes_admin.js.
const { handleSpawnRoute: _handleSpawnRoute } = require('./routes_admin');

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
// _tryParseJson + _detectUpstreamFailure + _alertCooldownActive moved to
// failure_classification.js (~109 LOC out). Bind into local names so
// call sites in handleRequest below stay unchanged.
const {
  _tryParseJson,
  detectUpstreamFailure: _detectUpstreamFailure,
  alertCooldownActive: _alertCooldownActive,
} = require('./failure_classification');

// Passthrough-mode emergency compaction: when the escape hatch has tripped,
// drop oldest assistant/user message PAIRS until the serialized payload is
// under a hard byte cap. Anthropic's 429 (TPM) is caused by the *size* of
// the request, not its mutation, so passthrough's "no mutation" pledge
// is useless against this failure mode -- shrink-or-die is the only path.
// Skipped entirely with HME_NO_PASSTHROUGH_COMPACT=1 if the operator
// prefers strict passthrough (and being stuck in 429-loop).
//
// Static fallback compact threshold: 250 KB (~71K tokens at ~3.5
// bytes/token). Used when no anthropic-ratelimit-input-tokens-limit
// header has been observed yet OR when HME_PROXY_COMPACT_BYTES is
// explicitly set as an operator override. Once a response header
// reveals the user's actual ITPM cap, the effective ceiling is derived
// from that cap (50% rule) -- so Max 20x users with much higher caps
// stop being throttled at 250 KB after the first response lands.
const _PASSTHROUGH_COMPACT_BYTES = parseInt(process.env.HME_PROXY_COMPACT_BYTES || '250000', 10);
const _COMPACT_BYTES_EXPLICIT = process.env.HME_PROXY_COMPACT_BYTES != null
  && process.env.HME_PROXY_COMPACT_BYTES !== '';
const _PASSTHROUGH_COMPACT_KEEP_MIN = 4;

// Dynamic threshold: track the most recent ITPM-remaining from Anthropic
// response headers and shrink the byte budget when we're close to the
// rate-limit ceiling. ~3.5 bytes/token is the rough conversion for
// Claude-Code-shape JSON payloads. Floor at 40 KB so we never over-shrink.
let _lastInputTokensRemaining = null; // updated by response handler
let _lastInputTokensLimit = null;     // user's actual ITPM cap, learned from headers
let _consecutive429s = 0;             // panic-shrink trigger: each 429 halves threshold
const _BYTES_PER_TOKEN_EST = 3.5;
const _DYNAMIC_THRESHOLD_FLOOR_BYTES = 40_000;
function _effectiveCompactThreshold() {
  // CEILING: when an operator has explicitly set HME_PROXY_COMPACT_BYTES
  // we honor it as a hard cap (debugging, force-shrink scenarios).
  // Otherwise, when we've learned the user's actual ITPM cap, use 50%
  // of it -- request body must fit in ~50% of cap to leave room for
  // response + any parallel sub-pipeline calls. Falls back to static
  // 250 KB until the first response header reveals the real cap.
  let ceiling;
  if (_COMPACT_BYTES_EXPLICIT) {
    ceiling = _PASSTHROUGH_COMPACT_BYTES;
  } else if (_lastInputTokensLimit != null && _lastInputTokensLimit > 0) {
    ceiling = Math.floor(_lastInputTokensLimit * 0.50 * _BYTES_PER_TOKEN_EST);
  } else {
    ceiling = _PASSTHROUGH_COMPACT_BYTES;
  }

  // PANIC SHRINK: each consecutive 429 halves the ceiling. Resets to 0
  // on a successful response. Without this we'd loop 429ing at the
  // same size forever -- the dynamic-from-remaining path only activates
  // on a 200 response that gives us the remaining-tokens header.
  let panicCap = ceiling;
  if (_consecutive429s > 0) {
    panicCap = Math.max(_DYNAMIC_THRESHOLD_FLOOR_BYTES, Math.floor(ceiling / Math.pow(2, _consecutive429s)));
  }

  // From CURRENT remaining (what's left in this rolling minute): 70%
  // of remaining lets us fit the request and leave headroom.
  let remainingCap = ceiling;
  if (_lastInputTokensRemaining != null && _lastInputTokensRemaining > 0) {
    remainingCap = Math.floor(_lastInputTokensRemaining * 0.70 * _BYTES_PER_TOKEN_EST);
  }

  const eff = Math.min(panicCap, remainingCap);
  return Math.max(_DYNAMIC_THRESHOLD_FLOOR_BYTES, eff);
}
// Opus serializer.
//
// Empirically: OAuth Bearer + claude-opus-* on this account has a small
// OTPM (output-tokens-per-minute) bucket. Concurrent Opus requests (tool
// fan-out, /loop, multiple subagents) instantly exhaust it -- each one
// reserves max_tokens against the bucket at request time -- and Anthropic
// 429s every Opus request until the rolling window refills (~60s).
//
// Gate: at most ONE Opus request in flight at a time, with a minimum gap
// of OPUS_MIN_GAP_MS between the END of one Opus request and the START
// of the next. Sized for ~12k tokens/req and a ~32k OTPM cap (default
// 6s → 10 req/min → 120k tokens/min worst-case which leaves headroom).
//
// Tunable:
//   HME_PROXY_OPUS_MIN_GAP_MS = ms (default 6000). Set 0 to disable the
//   gap (still serializes, just no extra delay).
//   HME_PROXY_OPUS_GATE_OFF=1 to bypass the gate entirely.
let _opusInflight = Promise.resolve();
let _lastOpusFinishedAt = 0;
const OPUS_MIN_GAP_MS = parseInt(process.env.HME_PROXY_OPUS_MIN_GAP_MS || '6000', 10);
const OPUS_GATE_OFF = process.env.HME_PROXY_OPUS_GATE_OFF === '1';
async function _acquireOpusSlot() {
  if (OPUS_GATE_OFF) return () => {};
  const prev = _opusInflight;
  let release;
  _opusInflight = new Promise((r) => { release = r; });
  try { await prev; } catch (_) { /* prior failure shouldn't block successor */ }
  const sinceLast = Date.now() - _lastOpusFinishedAt;
  if (_lastOpusFinishedAt > 0 && sinceLast < OPUS_MIN_GAP_MS) {
    const delay = OPUS_MIN_GAP_MS - sinceLast;
    console.error(`[hme-proxy] Opus-gate: queuing ${delay}ms (rolling-window protection)`);
    await new Promise((r) => setTimeout(r, delay));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _lastOpusFinishedAt = Date.now();
    release();
  };
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

  // TIER 1 -- microcompact: shrink tool_result blocks in older messages
  // by replacing their content with a short elision marker. Floor=500
  // (was 2000): observed real conversations have many ~1KB tool_results
  // that escaped the 2KB floor and left the body still over threshold.
  // Recent-keep=10% (was 30%): preserve only the freshest 10% of context
  // verbatim so older tool calls compact maximally. Most large requests
  // should now stop at tier 1 with no message drops.
  const _TOOL_RESULT_BYTE_FLOOR = 500;
  const _RECENT_KEEP_FRACTION = 0.10;
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

// _handleSpawnRoute + _handleLifecycleRoute moved to routes_admin.js +
// lifecycle_bridge.js respectively. Bound at the top of this file.

function handleRequest(clientReq, clientRes) {
  if (clientReq.url === '/health') {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({
      status: 'ok', port: PORT, version: PROXY_VERSION, git_sha: PROXY_GIT_SHA, started_at: PROXY_STARTED_AT, supervisor: supervisorStatus(),
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
  // Short-circuit useless probes BEFORE upstream forwarding. These were
  // burning Cloudflare's per-IP rate budget on api.anthropic.com (each
  // probe forwarded, returned 404 from Anthropic, but counted against
  // the Cloudflare WAF rate limiter -- so when the interactive request
  // came in seconds later, Cloudflare 429ed it). Anthropic's API has no
  // valid response for `/` or favicon; return 404 locally instead of
  // forwarding. We drop these silently (no lifesaver alert) since they're
  // routine probes from monitors/health-checks/browsers.
  const _USELESS_PATHS = ['/', '/favicon.ico', '/robots.txt'];
  if (clientReq.url && _USELESS_PATHS.includes(clientReq.url)) {
    clientRes.writeHead(404, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ error: 'not_found', note: 'hme-proxy: useless-path probe short-circuited (not forwarded to Anthropic)' }));
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
    // Reactive size compaction. ONLY runs when the escape hatch has
    // already tripped (passthrough mode). Previously this ran proactively
    // on every large request "to prevent the FIRST 429" -- empirically
    // that was the BUG. Dropping ~1000 oldest messages from a continuing
    // conversation destroys Anthropic's prompt-cache prefix; every
    // precompacted request becomes a fresh cache key billing full input
    // tokens, which exhausts the Opus input bucket fast. Direct (no
    // proxy) keeps the prefix intact -> cache hits -> no exhaustion.
    // Verified 2026-05-03: 224KB snapshot that 429ed contained a synthetic
    // "1169 oldest message(s) dropped" marker as msg[0]; replay of the
    // mutated body 429ed identically; Haiku via same path/auth worked
    // (separate bucket, lower price, less cache-miss pressure).
    // Reactive shrinking when the escape hatch has tripped is still
    // valuable: at that point caching is already broken and the body
    // genuinely needs to fit. Disable with HME_NO_PASSTHROUGH_COMPACT=1.
    if (_passthrough && isAnthropic && _isInteractivePath && payload && Array.isArray(payload.messages)) {
      const _dropped = _shrinkForPassthrough(payload);
      if (_dropped > 0) {
        outBody = Buffer.from(JSON.stringify(payload), 'utf8');
      }
      // OTPM cap REMOVED. The previous version capped max_tokens from
      // Claude Code's 64000 down to ~14k on the hypothesis that the
      // OAuth-public endpoint had a small OTPM bucket. Empirically the
      // opposite was true: this cap was the proxy-vs-direct delta that
      // caused Opus 4.7 to 429 through the proxy while succeeding direct.
      // When `output_config.effort=xhigh` is set (Claude Code's standard
      // request shape on this account), the gateway appears to require
      // max_tokens to match the effort tier; capping it produces a
      // gateway-level rejection that surfaces as a 429 with NO
      // anthropic-ratelimit-* headers (distinguishing it from a real
      // quota-bucket rejection). Re-enable via HME_PROXY_MAX_OUTPUT_TOKENS
      // ONLY for explicit debugging; the default is now passthrough.
      const _otpmCapRaw = process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
      if (_otpmCapRaw) {
        const _otpmCap = parseInt(_otpmCapRaw, 10);
        const _maxTokensCap = _otpmCap + 2048;
        let _capChanged = false;
        if (payload.thinking && typeof payload.thinking === 'object') {
          if (typeof payload.thinking.budget_tokens === 'number' && payload.thinking.budget_tokens > _otpmCap) {
            console.error(`[hme-proxy] OTPM-cap (explicit): thinking.budget_tokens ${payload.thinking.budget_tokens} -> ${_otpmCap}`);
            payload.thinking.budget_tokens = _otpmCap;
            _capChanged = true;
          }
        }
        if (typeof payload.max_tokens === 'number' && payload.max_tokens > _maxTokensCap) {
          console.error(`[hme-proxy] OTPM-cap (explicit): max_tokens ${payload.max_tokens} -> ${_maxTokensCap}`);
          payload.max_tokens = _maxTokensCap;
          _capChanged = true;
        }
        if (_capChanged) {
          outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        }
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
          // consumeStatusContext returns null when the snapshot is byte-
          // identical to the last value emitted for this session. Stops
          // re-injecting stale content (e.g. a "last verdict" line that
          // hasn't changed in hours) on every turn -- that was pure
          // coherence noise and masked real diagnostics.
          const statusBlock = consumeStatusContext(session);
          if (statusBlock) {
            // CRITICAL: status content varies per-turn (proxy_emergency
            // flag, last verdict, error counts), so it MUST NOT live in
            // the system array -- doing so invalidates the entire prompt
            // cache below the cache_control breakpoint and rebills every
            // request at full ITPM cost, exhausting the user's quota in
            // ~10 turns. Route through the same cache-safe last-user-
            // message path that lifesaver_inject already uses.
            const injectedStatus = injectIntoLastUserMessage(payload, statusBlock.trim(), 'HME Session Status (proxy-injected)');
            if (injectedStatus) {
              emit({ event: 'status_inject', session });
              bodyDirtiedByStrip = true;
            }
          }
          if (scan.jurisdictionTargets.length > 0) {
            // Jurisdiction targets vary per turn (different files touched,
            // different open hypotheses) -- same cache-invalidation risk
            // as status block. Route through cache-safe path.
            const block = buildJurisdictionContext(scan.jurisdictionTargets);
            injected = injectIntoLastUserMessage(payload, block, 'HME Jurisdiction Context (proxy-injected)');
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

    // OAuth Bearer + Claude-Code body-shape fix-up.
    //
    // EMPIRICAL FINDING (verified live with curl on 2026-05-03):
    //   - OAuth Bearer + anthropic-beta=oauth-2025-04-20 routes Opus
    //     requests to a STRICTER OTPM metering bucket; first request
    //     burns the OAuth-path cap and subsequent Opus requests 429
    //     until the rolling window clears. Haiku via the same path
    //     works fine (different bucket).
    //   - Claude Code's native path (whatever beta tag IT sends with
    //     whatever auth header IT uses) routes to the standard Claude
    //     Code subscription bucket and works without 429s.
    //   - User has confirmed the issue resolves the moment they turn
    //     off ANTHROPIC_BASE_URL routing in VS Code.
    //
    // Therefore: pass Claude Code's incoming `anthropic-beta` THROUGH
    // unchanged. Only inject `oauth-2025-04-20` when Claude Code didn't
    // send any beta header (no native value to preserve). This keeps
    // Claude Code's standard metering bucket and avoids the Opus-OTPM
    // 429 trap.
    //
    // Body fix-up: strip `context_management` only if the OAuth-public
    // path complains. With the native beta tag preserved, Anthropic
    // tolerates Claude-Code-only fields, so leave the body alone too.
    if (isAnthropic && typeof upstreamHeaders['authorization'] === 'string'
        && upstreamHeaders['authorization'].startsWith('Bearer ')) {
      if (!upstreamHeaders['anthropic-beta']) {
        upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
      }
      // No payload mutation -- preserve Claude Code's native body shape
      // (including context_management, which the native bucket accepts).
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

    // Opus gate: serialize concurrent Opus requests + enforce a minimum
    // inter-request gap so we don't burst-exhaust the OAuth-path OTPM
    // bucket. Held for the lifetime of the upstream request (released
    // in upstreamRes 'end' / 'error' / upstreamReq 'error').
    const _isOpusReq = isAnthropic && _isInteractivePath
      && payload && typeof payload.model === 'string'
      && /opus/i.test(payload.model);
    let _releaseOpusSlot = () => {};
    if (_isOpusReq) {
      _releaseOpusSlot = await _acquireOpusSlot();
    }

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

      // FP-CHECK upstream-kill: detect `[FP-CHECK: yes]` in TEXT-block
      // deltas only, not thinking-block deltas. Earlier version did
      // bare-substring scan -> killed the stream when the marker
      // appeared inside thinking content (which happens any time the
      // model reasons ABOUT the marker), producing blank responses.
      // Now: regex requires `text_delta` to appear in the same SSE
      // event line as the marker. SSE events are `event: ... \n
      // data: {"type":"content_block_delta","delta":{"type":
      // "text_delta","text":"..."}}` -- so text_delta + marker in one
      // chunk means a text delta containing the marker, not thinking.
      let _fpKillTriggered = false;
      let _fpTrailingBuf = '';
      let _fpEligible = false;
      try {
        const _fpMsgs = (payload && payload.messages) || [];
        let _fpLastUserText = '';
        for (const m of _fpMsgs) {
          if (!m || m.role !== 'user') continue;
          const c = m.content;
          if (typeof c === 'string') {
            _fpLastUserText = c;
          } else if (Array.isArray(c)) {
            _fpLastUserText = c.filter((b) => b && b.type === 'text')
              .map((b) => b.text || '').join(' ') || _fpLastUserText;
          }
        }
        const _fpDenyMarkers = [
          'Stop hook feedback:',
          'Stop hook blocking error from command:',
          'AUTO-COMPLETENESS',
          'EXHAUST PROTOCOL',
          'PSYCHOPATHIC-STOP',
          'STOP-WORK ANTIPATTERN',
          'ADVISOR DOCTRINE',
          'PHANTOM CAPABILITY',
          'PHANTOM PARAPHRASE',
          'SPECULATION-DEBT SCAN',
          'SCOPE-ESCAPE VIOLATION',
          'NEXUS --',
          'VERIFICATION DOCTRINE',
          'SYSTEMATIC-DEBUGGING PHASE GATE',
        ];
        _fpEligible = _fpLastUserText && _fpDenyMarkers.some((m) => _fpLastUserText.includes(m));
      } catch (_e) { /* best-effort -- if we can't detect eligibility, no kill */ }

      // text_delta event contains both the discriminator and the marker
      // text in the same JSON line. thinking_delta uses field "thinking"
      // not "text", so its content with the marker substring won't match
      // this combined pattern.
      const _FP_TEXT_DELTA_RE = /"type"\s*:\s*"text_delta"[\s\S]{0,200}\[FP-CHECK:\s*yes\]|\[FP-CHECK:\s*yes\][\s\S]{0,200}"type"\s*:\s*"text_delta"/;

      upstreamRes.on('data', (c) => {
        chunks.push(c);
        if (!_fpEligible || _fpKillTriggered) return;
        try {
          const chunkStr = c.toString('utf8');
          const scan = _fpTrailingBuf + chunkStr;
          if (_FP_TEXT_DELTA_RE.test(scan)) {
            _fpKillTriggered = true;
            try {
              const fs2 = require('fs');
              const path2 = require('path');
              fs2.appendFileSync(
                path2.join(PROJECT_ROOT, 'log', 'hme-fp-gate-kills.jsonl'),
                JSON.stringify({
                  ts: new Date().toISOString(),
                  bytes_before_kill: chunks.reduce((acc, b) => acc + b.length, 0),
                }) + '\n',
              );
            } catch (_e) { /* stat is best-effort */ }
            try { upstreamReq.destroy(); } catch (_e) { /* ignore */ }
          } else {
            // Trailing buffer must cover both the regex window AND the
            // marker length. 600 bytes covers a text_delta + 200-char
            // distance + the marker comfortably.
            _fpTrailingBuf = scan.slice(-600);
          }
        } catch (_e) { /* scan is best-effort */ }
      });
      upstreamRes.on('end', async () => {
        try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
        let fullBody = Buffer.concat(chunks);
        let status = upstreamRes.statusCode || 502;
        let headers = { ...upstreamRes.headers };
        // Capture Anthropic's rate-limit telemetry so the next request's
        // _shrinkForPassthrough can size the byte budget dynamically
        // instead of using the static 400KB ceiling. Header name per
        // https://platform.claude.com/docs/en/api/rate-limits.
        const _hdrTokRemaining = headers['anthropic-ratelimit-input-tokens-remaining'];
        const _hdrTokLimit = headers['anthropic-ratelimit-input-tokens-limit'];
        const _hdrTokReset = headers['anthropic-ratelimit-input-tokens-reset'];
        if (_hdrTokRemaining != null) {
          const n = parseInt(_hdrTokRemaining, 10);
          if (Number.isFinite(n) && n >= 0) _lastInputTokensRemaining = n;
        }
        if (_hdrTokLimit != null) {
          const n = parseInt(_hdrTokLimit, 10);
          if (Number.isFinite(n) && n > 0) _lastInputTokensLimit = n;
        }
        // On any 4xx, dump the rate-limit telemetry so we can SEE what
        // Anthropic told us (instead of the unhelpful "Error" body).
        if (status >= 400 && status < 500 && (_hdrTokLimit || _hdrTokRemaining || _hdrTokReset || headers['retry-after'])) {
          console.error(`[hme-proxy] rate-limit headers: limit=${_hdrTokLimit||'?'} remaining=${_hdrTokRemaining||'?'} reset=${_hdrTokReset||'?'} retry-after=${headers['retry-after']||'?'}`);
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
            const _shouldRetry = headers['x-should-retry'] === 'true';
            const _isRateLimit = _errInfo.type === 'rate_limit_error';
            // ITPM-exhaustion bumps panic-shrink so next request is smaller.
            // Cloudflare-rate-throttle (x-should-retry=true) doesn't benefit
            // from shrinking because the limiter is per-IP-per-second of
            // requests, not bytes -- skip the panic counter for those.
            if (_isRateLimit && !_shouldRetry) {
              _consecutive429s = Math.min(_consecutive429s + 1, 4);
              console.error(`[hme-proxy] rate_limit_error (ITPM-exhaustion) -- panic-shrink counter=${_consecutive429s}, next threshold=${_effectiveCompactThreshold()}B`);
            } else if (_isRateLimit && _shouldRetry) {
              console.error(`[hme-proxy] rate_limit_error (Cloudflare per-IP throttle) -- skip panic-shrink (size irrelevant)`);
            }
            // Trip the escape hatch on EVERY interactive 4xx, including
            // x-should-retry=true 429s. The user explicitly wants the
            // lifesaver alert as a recovery signal regardless of cause.
            // The line-688 precompact still runs in passthrough so we
            // don't ship raw 1.5MB body.
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
              fs.writeFileSync(outFile.replace('.json', '.headers.json'), JSON.stringify(headers, null, 2));
              try {
                const _reqHdrSnap = {
                  method: clientReq.method,
                  url: clientReq.url,
                  incoming_headers: clientReq.headers,
                  outgoing_headers: upstreamHeaders,
                };
                fs.writeFileSync(outFile.replace('.json', '.request-headers.json'), JSON.stringify(_reqHdrSnap, null, 2));
              } catch (_e) { /* best-effort */ }
              console.error(`[hme-proxy] payload snapshotted to ${outFile}`);
              // Lifesaver alert is for the AGENT to act on. Skip alerts for:
              //   - sub-pipeline 404s on path=/ (probe noise, not actionable)
              //   - cooldown-suppressed duplicates within 60s window
              // x-should-retry 429s DO get an alert (user wants to see them
              // even though they're transient -- it's the recovery signal).
              const _suppressLifesaver = _coolingDown
                || (status === 404 && _pathLabel === 'sub-pipeline');
              if (!_suppressLifesaver) {
                const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
                fs.appendFileSync(errLog,
                  `[${_stamp}] UPSTREAM_${status}_${_pathLabel.toUpperCase()}: ${_errMsg} (request_id=${_errInfo.requestId || '?'}, snapshot=${_snapshotRel})\n`);
              }
            } catch (err) {
              console.error(`[hme-proxy] snapshot/lifesaver write failed: ${err.message}`);
            }
            emit({ event: 'upstream_error', session: _sessionForTelemetry, status, type: _errInfo.type, message: _errInfo.message, path_label: _pathLabel });
            // NO retry-on-429. Tested empirically: when Cloudflare's per-IP
            // rate limiter is engaged, all retries from the same IP also
            // 429 (because the throttle window is sustained, not just a
            // momentary spike). Retrying just adds N more requests to the
            // throttle window, extending it. Better to fail fast, trip the
            // escape hatch (lifesaver alert visible), and let the user
            // wait out the window.
            // Auto-refresh-and-retry on 401 (modelled on horselock).
            // Token expired => refresh credentials.json => retry once.
            // Single in-flight refresh promise via refreshOauthToken's
            // own dedup, so a burst of 401s only fires one refresh.
            // Only attempt for OAuth Bearer requests; api-key auth
            // doesn't have a refresh path.
            const _isBearerAuth = typeof upstreamHeaders['authorization'] === 'string'
              && upstreamHeaders['authorization'].startsWith('Bearer ');
            if (status === 401 && _isBearerAuth && payload && Array.isArray(payload.messages)) {
              try {
                console.error('[hme-proxy] got 401, attempting token refresh + retry');
                const newToken = await refreshOauthToken();
                const retryHeaders = { ...upstreamHeaders, 'authorization': `Bearer ${newToken}` };
                retryHeaders['content-length'] = String(outBody.length);
                const retryOpts = { ...upstreamOpts, headers: retryHeaders };
                const retry = await new Promise((resolve, reject) => {
                  const req = transport.request(retryOpts, (res) => {
                    const cs = [];
                    res.on('data', (c) => cs.push(c));
                    res.on('end', () => resolve({ statusCode: res.statusCode || 502, headers: { ...res.headers }, body: Buffer.concat(cs) }));
                    res.on('error', reject);
                  });
                  req.on('error', reject);
                  req.write(outBody);
                  req.end();
                });
                console.error(`[hme-proxy] 401-retry response: ${retry.statusCode}`);
                if (retry.statusCode >= 200 && retry.statusCode < 300) {
                  status = retry.statusCode;
                  headers = retry.headers;
                  fullBody = retry.body;
                  recordUpstreamSuccess();
                }
              } catch (refreshErr) {
                console.error(`[hme-proxy] 401-refresh failed: ${refreshErr.message}`);
              }
            }
          } else {
            recordUpstreamSuccess();
            if (_consecutive429s > 0) {
              console.error(`[hme-proxy] success -- resetting panic-shrink counter (was ${_consecutive429s})`);
              _consecutive429s = 0;
            }
          }
        } else if (status >= 200 && status < 300) {
          recordUpstreamSuccess();
          if (_consecutive429s > 0) {
            console.error(`[hme-proxy] success -- resetting panic-shrink counter (was ${_consecutive429s})`);
            _consecutive429s = 0;
          }
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

        // EXHAUSTIVE RESPONSE DUMPER: capture COMPLETE raw bodies + all
        // headers + parsed events for EVERY transaction (anthropic + sub).
        // No truncation. Rotate to keep last 200 dumps. Each dump is a
        // self-contained .json with everything needed to fingerprint a
        // failure -- no need to grep logs or correlate.
        try {
          if (!isAnthropic) throw new Error('skip-non-anthropic');
          const _bdPath = require('path');
          const _bdFs = require('fs');
          const { PROJECT_ROOT: _bdRoot } = require('./shared');
          const _dumpDir = _bdPath.join(_bdRoot, 'tmp', 'blank-debug');
          try { _bdFs.mkdirSync(_dumpDir, { recursive: true }); } catch (_e) { /* ignore */ }
          // Rotate: keep newest 199 (about to write #200).
          try {
            const _existing = _bdFs.readdirSync(_dumpDir)
              .filter((n) => n.startsWith('hme-resp-') && (n.endsWith('.json') || n.endsWith('.body')))
              .map((n) => ({ n, t: _bdFs.statSync(_bdPath.join(_dumpDir, n)).mtimeMs }))
              .sort((a, b) => b.t - a.t);
            for (const { n } of _existing.slice(199 * 2)) {
              try { _bdFs.unlinkSync(_bdPath.join(_dumpDir, n)); } catch (_e) { /* ignore */ }
            }
          } catch (_e) { /* ignore rotation errors */ }

          const _isSse = (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
          const _bodyStr = outBuf.toString('utf8');
          let _textChars = 0;
          let _textBlocks = 0;
          let _thinkingChars = 0;
          let _thinkingBlocks = 0;
          let _toolUseBlocks = 0;
          let _stopReason = null;
          let _errorEventsSeen = [];
          const _events = [];
          if (_isSse) {
            for (const evRaw of _bodyStr.split('\n\n')) {
              if (!evRaw.trim()) continue;
              let evName = '';
              let evDataLines = [];
              for (const line of evRaw.split('\n')) {
                if (line.startsWith('event: ')) evName = line.slice(7).trim();
                else if (line.startsWith('data: ')) evDataLines.push(line.slice(6));
              }
              const evDataStr = evDataLines.join('\n');
              let evData = null;
              try { evData = JSON.parse(evDataStr); } catch (_e) { /* skip non-JSON */ }
              _events.push({ event: evName, data: evData });
              if (evName === 'content_block_start' && evData && evData.content_block) {
                const t = evData.content_block.type;
                if (t === 'text') _textBlocks++;
                else if (t === 'thinking') _thinkingBlocks++;
                else if (t === 'tool_use') _toolUseBlocks++;
              } else if (evName === 'content_block_delta' && evData && evData.delta) {
                if (evData.delta.type === 'text_delta' && typeof evData.delta.text === 'string') {
                  _textChars += evData.delta.text.length;
                } else if (evData.delta.type === 'thinking_delta' && typeof evData.delta.thinking === 'string') {
                  _thinkingChars += evData.delta.thinking.length;
                }
              } else if (evName === 'message_delta' && evData && evData.delta && evData.delta.stop_reason) {
                _stopReason = evData.delta.stop_reason;
              } else if (evName === 'error') {
                _errorEventsSeen.push(evData);
              }
            }
          }
          // Verdict: visible to user? text_chars>0 OR tool_use blocks present.
          const _isBlank = _textChars === 0 && _toolUseBlocks === 0;
          const _verdict = _isBlank ? 'BLANK' : 'OK';
          const _ts = new Date().toISOString().replace(/[:.]/g, '-');
          const _path_label = _isInteractivePath ? 'interactive' : 'sub';
          const _corrId = `${_ts}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
          const _dumpFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.json`);
          const _bodyFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.body`);
          const _reqBodyFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.req-body`);
          // Filter env to relevant vars (avoid dumping secrets like OAuth
          // tokens or API keys, but keep behaviour-influencing config).
          const _envSnap = {};
          for (const [k, v] of Object.entries(process.env)) {
            if (/^(HME_|CLAUDE_CODE_|ANTHROPIC_(BASE_URL|MODEL|VERSION|BETA))/.test(k)) {
              _envSnap[k] = v;
            }
          }
          // Sanitize headers: scrub auth bearer / api-key but keep header
          // PRESENCE (key-listed) so we can tell whether Claude Code sent
          // auth at all.
          const _sanitize = (h) => {
            const out = {};
            for (const [k, v] of Object.entries(h || {})) {
              const lk = String(k).toLowerCase();
              if (lk === 'authorization' || lk === 'x-api-key' || lk === 'cookie') {
                out[k] = typeof v === 'string'
                  ? `<redacted len=${v.length} prefix=${v.slice(0, 12)}...>`
                  : '<redacted>';
              } else { out[k] = v; }
            }
            return out;
          };
          const _dump = {
            ts: new Date().toISOString(),
            corr_id: _corrId,
            verdict: _verdict,
            path_label: _path_label,
            request: {
              method: clientReq.method,
              url: clientReq.url,
              client_headers: _sanitize(clientReq.headers),
              upstream_outgoing_headers: _sanitize(upstreamHeaders),
              body_bytes: bodyBuf.length,
              outBody_bytes: outBody.length,
              proxy_mutated_body: outBody.length !== bodyBuf.length,
              payload_summary: payload ? {
                model: payload.model,
                thinking: payload.thinking,
                output_config: payload.output_config,
                max_tokens: payload.max_tokens,
                stream: payload.stream,
                temperature: payload.temperature,
                messages_count: Array.isArray(payload.messages) ? payload.messages.length : 0,
                system_block_count: Array.isArray(payload.system) ? payload.system.length : (payload.system ? 1 : 0),
                system_total_chars: Array.isArray(payload.system)
                  ? payload.system.reduce((acc, b) => acc + ((b && b.text) ? b.text.length : 0), 0)
                  : (typeof payload.system === 'string' ? payload.system.length : 0),
                tools_count: Array.isArray(payload.tools) ? payload.tools.length : 0,
                betas: payload.betas,
                tool_choice: payload.tool_choice,
                metadata: payload.metadata,
              } : null,
            },
            response: {
              status: outStatus,
              headers: outHeaders,
              body_bytes: outBuf.length,
              is_sse: _isSse,
              had_continuation: !!final,
              text_chars: _textChars,
              thinking_chars: _thinkingChars,
              text_blocks: _textBlocks,
              thinking_blocks: _thinkingBlocks,
              tool_use_blocks: _toolUseBlocks,
              total_events: _events.length,
              stop_reason: _stopReason,
              error_events: _errorEventsSeen,
            },
            // Full parsed event log so we can see EXACTLY what came back,
            // event-by-event. No truncation.
            events: _events,
            // Proxy state at the time of the response.
            proxy_state: {
              passthrough_mode: _passthrough,
              consecutive_429s: typeof _consecutive429s !== 'undefined' ? _consecutive429s : null,
              last_input_tokens_remaining: typeof _lastInputTokensRemaining !== 'undefined' ? _lastInputTokensRemaining : null,
              last_input_tokens_limit: typeof _lastInputTokensLimit !== 'undefined' ? _lastInputTokensLimit : null,
              proxy_pid: process.pid,
              proxy_uptime_s: Math.round(process.uptime()),
            },
            env_snapshot: _envSnap,
          };
          try {
            // Write the structured JSON dump.
            _bdFs.writeFileSync(_dumpFile, JSON.stringify(_dump, null, 2));
            // Write FULL raw response body alongside (binary-safe). This
            // is the unmodified bytes the client receives, so any encoding
            // weirdness is preserved exactly. No size cap.
            _bdFs.writeFileSync(_bodyFile, outBuf);
            // Write FULL incoming request body too (post any proxy
            // mutation -- this is what's about to be sent upstream OR was
            // received from Claude Code, depending on outBody === bodyBuf).
            _bdFs.writeFileSync(_reqBodyFile, outBody);
            console.error(`[hme-proxy] dump ${_verdict}/${_path_label} status=${outStatus} sse=${_isSse} textC=${_textChars} thC=${_thinkingChars} blocks=${_textBlocks}t/${_thinkingBlocks}th/${_toolUseBlocks}tu stop=${_stopReason} bodyB=${outBuf.length} reqB=${outBody.length} -> ${_dumpFile}`);
          } catch (_e) { console.error(`[hme-proxy] dump write failed: ${_e.message} stack=${_e.stack}`); }
        } catch (_e) {
          if (_e && _e.message === 'skip-non-anthropic') { /* expected */ }
          else { console.error(`[hme-proxy] response-trace dumper threw: ${_e.message} stack=${_e.stack}`); }
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
          const { runInBackgroundRewrite, longLeadingSleepRewrite, ackStripRewrite, slopStripRewrite, hallucinatedTurnPrefixStripRewrite, stopHookCeremonyStripRewrite, fpGateMarkerRewrite } = require('./sse_rewriters');
          // Order matters: longLeadingSleepRewrite rewrites command
          // BEFORE runInBackgroundRewrite reads it on content_block_stop.
          // Both hold state keyed by content-block index in the same
          // ctx map so they see consistent data.
          // stopHookCeremonyStripRewrite runs FIRST when prior user was
          // a stop-hook payload (gated). If the agent's first text block
          // is bypass-explanation ceremony, replace with `.` and drop
          // all subsequent content -- saves next-turn context burn from
          // carrying the ceremony forward in transcript.
          // hallucinatedTurnPrefixStripRewrite runs next so a fake
          // `Human:` / `Assistant:` block is dropped before downstream
          // rewriters waste work on it. Always-on (no gate) -- a fake
          // turn boundary is never legitimate.
          // slopStripRewrite runs LAST in the chain so ackStripRewrite
          // gets first crack at bare-ack drops (no point stripping slop
          // out of a block we're about to discard whole). slopStrip is
          // always-on; ackStrip is only-when-priorUserWasDeny.
          const xform = new SseTransform({
            // fpGateMarkerRewrite runs FIRST: handles the structured
            // [FP-CHECK: yes/no] marker injected by stop_hook_fp_gate
            // middleware. yes -> truncate to `.`; no -> strip marker
            // line, pass rest through. Catches what the chunk-level
            // upstream kill in hme_proxy.js may have let through (the
            // partial buffer that arrived before destroy()).
            // stopHookCeremonyStripRewrite is the prose-shape fallback
            // for when the agent ignores the fp-gate entirely.
            rewriters: [fpGateMarkerRewrite, stopHookCeremonyStripRewrite, hallucinatedTurnPrefixStripRewrite, longLeadingSleepRewrite, runInBackgroundRewrite, ackStripRewrite, slopStripRewrite],
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
                  // Stat-only: write to a SEPARATE log, not errors.log.
                  // Mirrors the SSE-path policy in sse_rewriters.js. The
                  // strip below is the cure; emitting to errors.log made
                  // every successful strip re-surface as an unresolved
                  // error every turn -- coherence-noise spam.
                  try {
                    const _ackContext = userIsDeny ? 'cascade-after-deny' : 'cascade-no-deny';
                    fs.appendFileSync(
                      path.join(PROJECT_ROOT, 'log', 'hme-bare-ack-strips.jsonl'),
                      JSON.stringify({
                        ts: new Date().toISOString(),
                        path: 'non-sse',
                        context: _ackContext,
                      }) + '\n',
                    );
                  } catch (_e2) { /* stat is best-effort */ }
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
        try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
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
      try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
      upstreamReq.destroy(new Error('upstream timeout'));
    });

    upstreamReq.on('error', (err) => {
      try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
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
