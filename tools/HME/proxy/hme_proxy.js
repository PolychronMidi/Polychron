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

// Self-load .env via shared helper; parent shell may not have sourced it.
(() => {
  try {
    const { loadEnv } = require('./shared/load_env');
    loadEnv(require('path').resolve(__dirname, '..', '..', '..', '.env'));
  } catch (_e) { /* fail-soft: proxy still runs without .env knobs */ }
})();

// Proxy wire-level version: tools/HME/config/versions.json single source of truth.
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
console.log(`loaded middleware: ${_loadedMiddleware.join(', ')}`);

// Lifecycle hook bridge: all Claude Code lifecycle events funnel through
// hooks/_proxy_bridge.sh -> /hme/lifecycle. Implementation in
// lifecycle_bridge.js (SessionStart fires inline at module-require time).
const {
  recordLifecycleHit: _recordLifecycleHit,
  lifecycleInactive: _lifecycleInactive,
  runInlineFallback: _runInlineFallback,
  handleLifecycleRoute: _handleLifecycleRoute,
} = require('./lifecycle_bridge');
// handleSpawnRoute extracted to routes_admin.js.
const { handleSpawnRoute: _handleSpawnRoute } = require('./routes_admin');

// Legacy inline-tool path (HME_INJECT_TOOLS=1, default off): proxy injects
// HME_* tool schemas into payload.tools and dispatches HME_* tool_uses.
// Default surface is Bash(`npm run <tool>`) -> hme-cli.js -> worker HTTP.
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

// Upstream failure detection across both Anthropic error shapes (HTTP 4xx/5xx
// with JSON error, OR HTTP 200 + SSE `event: error`). Implementation in
// failure_classification.js; binding into local names preserves call sites.
const {
  _tryParseJson,
  detectUpstreamFailure: _detectUpstreamFailure,
  alertCooldownActive: _alertCooldownActive,
} = require('./failure_classification');

// Passthrough emergency compaction: drop oldest message PAIRS until payload
// is under the byte cap. Default 250KB (~71K tokens at 3.5 bytes/token);
// derived from ITPM cap once a response header reveals it (50% rule).
// HME_NO_PASSTHROUGH_COMPACT=1 to skip; HME_PROXY_COMPACT_BYTES to override.
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
  // CEILING: HME_PROXY_COMPACT_BYTES (explicit) honored as hard cap.
  // Otherwise: 50% of learned ITPM cap (leaves room for response +
  // parallel sub-calls). Falls back to 250 KB pre-first-response.
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
// Opus serializer: OAuth Bearer + opus-* has a small OTPM bucket; concurrent
// requests reserve max_tokens and 429 each other. Gate: 1 in-flight + min-gap
// between requests. HME_PROXY_OPUS_MIN_GAP_MS (default 6000), OFF=1 disables.
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
    console.error(`Opus-gate: queuing ${delay}ms (rolling-window protection)`);
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

  // TIER 1: microcompact -- elide older tool_result blocks. Floor=500B,
  // recent-keep=10%. Most large requests stop here with no message drops.
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
    console.error(`precompact tier-1 (microcompact): elided ${elided} stale tool_result block(s), body=${serialized.length}B`);
    if (serialized.length <= _threshold) {
      console.error(`precompact: tier-1 sufficient, no message drops needed`);
      return elided; // success at tier 1, no dropping required
    }
  }

  // TIER 2: summary-via-local-model fallback (HME_PROXY_LOCAL_SUMMARY=1).
  // Replaces oldest half with a marker; runs before tier-3 message-drop.
  // Stub -- a real summarization call would replace `_summaryText`.
  if (process.env.HME_PROXY_LOCAL_SUMMARY === '1' && msgs.length > _PASSTHROUGH_COMPACT_KEEP_MIN * 2) {
    const _half = Math.floor(msgs.length / 2);
    const _summaryText = `(hme-proxy local-summary placeholder: ${_half} oldest messages compacted)`;
    msgs.splice(0, _half, { role: 'user', content: _summaryText });
    serialized = JSON.stringify(payload);
    console.error(`precompact tier-2 (local-summary): collapsed ${_half} oldest msgs into 1 marker, body=${serialized.length}B`);
    if (serialized.length <= _threshold) return elided + _half;
  }

  // TIER 3: session-notes compact. If tmp/hme-session-notes.txt exists,
  // use it as the summary (skips model call; supersedes tier-2 marker).
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
        console.error(`precompact tier-3 (session-memory): used pre-extracted notes (${notes.length}B), body=${serialized.length}B`);
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
  // PASS 5: walk-backward tool-pair preservation. Drop leading user message
  // if it's tool_result-only with its tool_use in a dropped assistant block.
  // Iterate until the first surviving message is clean.
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

  // PASS 6: residual orphan scrub -- strip tool_result whose tool_use_id
  // isn't in surviving assistants (and vice versa). Empty content arrays
  // get a placeholder to satisfy Anthropic's non-empty-content rule.
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
    // Snapshot text from original blocks so output_file paths survive
    // orphan scrub when tool_use_id references a dropped prefix msg.
    const _origTexts = [];
    for (const b of m.content) {
      if (b && typeof b === 'object' && typeof b.text === 'string') _origTexts.push(b.text);
      if (b && typeof b === 'object' && b.type === 'tool_result' && typeof b.content === 'string') _origTexts.push(b.content);
    }
    m.content = m.content.filter((b) => {
      if (!b || typeof b !== 'object') return true;
      if (b.type === 'tool_result' && b.tool_use_id && !surviving_use_ids.has(b.tool_use_id)) return false;
      if (b.type === 'tool_use' && b.id && !surviving_result_ids.has(b.id)) return false;
      return true;
    });
    orphans += before - m.content.length;
    if (m.content.length === 0) {
      const _ofMatch = _origTexts.join(' ').match(/output_file:\s*(\S+)/);
      if (_ofMatch) {
        m.content = [{ type: 'text', text: `(hme-proxy compact: agent output at ${_ofMatch[1]})` }];
      } else {
        m.content = [{ type: 'text', text: '(content stripped by hme-proxy passthrough-compact)' }];
      }
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
  console.error(`passthrough-compact: dropped ${dropped} oldest messages, scrubbed ${orphans} orphan tool blocks (now ${msgs.length} msgs, body=${serialized.length}B)`);
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
      msg.content = [{ type: 'text', text: '[SUCCESS]' }];
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
    // Do NOT strip Claude Code's cache_control markers -- they're part of
    // the cache key. Don't add our own either (our ttl=5m after CC's ttl=1h
    // produces a 400). Skip already-present HME_ tools (retry-idempotent).
    const existing = new Set(payload.tools.map((t) => t && t.name).filter(Boolean));
    let injected = 0;
    for (const s of schemas) {
      if (!existing.has(s.name)) { payload.tools.push({ ...s }); injected++; }
    }
    return injected;
  } catch (err) {
    console.error(`[FAIL]: ${err.message}`);
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
  // Short-circuit useless probes BEFORE forwarding -- they burn the
  // Cloudflare per-IP rate budget and 429 real interactive requests.
  // Routine browser/monitor probes; drop silently.
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

    // Detect [HME-SENIOR-CONSULT] marker -- senior traffic must reach Anthropic.
    let _isSeniorConsult = false;
    if (payload && Array.isArray(payload.messages)) {
      for (const m of payload.messages) {
        const c = m && m.content;
        const txt = typeof c === 'string' ? c
          : Array.isArray(c) ? c.map((b) => (b && b.type === 'text' ? (b.text || '') : '')).join('')
          : '';
        if (txt.includes('[HME-SENIOR-CONSULT]')) { _isSeniorConsult = true; break; }
      }
    }

// OVERDRIVE_MODE=4 OmniRoute swap; zen_translator path behind HME_OMNIROUTE_OFF=1
    let _isMode4Swap = false;
    let _mode4WasStreaming = false;
    let _isMode4OmniRoute = false;
    let _swapChain = [];
    let _swapModel = 'deepseek-v4-pro';
    let _omniProvider = 'opencode-go';

    const _OMNIROUTE_PORT = process.env.HME_OMNIROUTE_PORT || '20128';
    const _OMNIROUTE_OFF = process.env.HME_OMNIROUTE_OFF === '1';
    const _odMode = process.env.OVERDRIVE_MODE || '0';

    if ((_odMode === '4' || _odMode === '5')
        && !_isSeniorConsult
        && payload && typeof payload.model === 'string'
        && payload.model.startsWith('claude-')
        && !clientReq.headers['x-hme-upstream']) {

      const _zenKey = process.env.OPENCODE_API_KEY || '';
      if (_zenKey) {
        _mode4WasStreaming = (payload.stream === true);
        injected = true;

        // Read swap model chain from config/models.json E5 tier.
        // Falls back through ranked models when primary rate-limits.
        try {
          const _cfgPath = require('path').resolve(__dirname, '..', '..', '..', 'config', 'models.json');
          const _cfg = JSON.parse(require('fs').readFileSync(_cfgPath, 'utf8'));
          // Build chain: toprank first, then E5 models by cost_order→tier_score
          const _top = (_cfg.manually_toprank && _cfg.manually_toprank.E5) || [];
          const _tm = (_cfg.tiers && _cfg.tiers.E5 && _cfg.tiers.E5.models) || [];
          const _co = (_cfg.ranking_rules && _cfg.ranking_rules.cost_order) || ['free', 'subscription', 'usage'];
          for (const _c of _co) {
            _swapChain.push(..._tm.filter(m => m.cost === _c).sort((a, b) => (b.tier_score || 0) - (a.tier_score || 0)));
          }
          // Prepend topranked (keep their order, deduped from chain)
          const _chainIds = new Set(_swapChain.map(m => m.id));
          const _topDeduped = _top.filter(id => !_chainIds.has(id));
          for (const _id of _topDeduped) {
            const _m = _tm.find(m => m.id === _id);
            if (_m) _swapChain.unshift(_m);
          }
          console.error(`[hme-proxy] MODE=${_odMode} E5 chain built: ${_swapChain.map(m => m.id).join(' -> ')} (${_swapChain.length} models)`);
          // Pick from chain: first model, unless a recent failure advanced us.
          if (_swapChain.length > 0) {
            let _stIdx = 0;
            try {
              const _fs2 = require('fs');
              const _pth2 = require('path');
              const _stFile2 = _pth2.join(__dirname, '..', '..', '..', 'tmp', 'hme-omni-swap-state.json');
              const _st2 = JSON.parse(_fs2.readFileSync(_stFile2, 'utf8'));
              _stIdx = Math.min(_st2.idx || 0, _swapChain.length - 1);
            } catch (_) {}
            _swapModel = _swapChain[_stIdx].id;
            const _p = _swapChain[_stIdx].provider || '';
            if (_p === 'codex') _omniProvider = 'cx';
            else if (_p === 'opencode_go') _omniProvider = 'opencode-go';
            else if (_p === 'opencode') _omniProvider = 'opencode';
          }
        } catch (_) { /* keep defaults */ }

        // Strip -go suffix: models.json uses it as a local cost-tier marker;
        // the actual OpenCode API rejects these (e.g. mimo-v2.5-pro-go → 400).
        if (_swapModel.endsWith('-go')) _swapModel = _swapModel.slice(0, -3);

        // Env override wins over auto-detection
        if (process.env.HME_OMNIROUTE_PROVIDER) _omniProvider = process.env.HME_OMNIROUTE_PROVIDER;
        const _omniModel = process.env.HME_OMNIROUTE_MODEL || _swapModel;

        if (!_OMNIROUTE_OFF) {
          // OmniRoute path (default)
          // Keep request in Anthropic format; OmniRoute handles translation.
          payload.model = `${_omniProvider}/${_swapModel}`;
          clientReq.headers['x-hme-upstream'] = `http://127.0.0.1:${_OMNIROUTE_PORT}`;
          delete clientReq.headers['authorization'];
          delete clientReq.headers['x-api-key'];
          _isMode4OmniRoute = true;

          console.error(`[hme-proxy] MODE=${_odMode} OmniRoute: claude-* -> ${_omniProvider}/${_swapModel} via http://127.0.0.1:${_OMNIROUTE_PORT} (stream=${_mode4WasStreaming})`);
        } else {
          // Legacy zen_translator path (HME_OMNIROUTE_OFF=1)
          const { translateRequestToOpenAI } = require('./zen_translator');
          const oaPayload = translateRequestToOpenAI(payload, _swapModel);
          clientReq.headers['x-hme-upstream'] = 'https://opencode.ai/zen/go';
          clientReq.headers['authorization'] = `Bearer ${_zenKey}`;
          clientReq.headers['x-api-key'] = _zenKey;
          clientReq.url = '/v1/chat/completions';
          outBody = Buffer.from(JSON.stringify(oaPayload), 'utf8');
          _isMode4Swap = true;

          console.error(`[hme-proxy] MODE=${_odMode} legacy: claude-* -> ${_swapModel} via Zen Go /v1/chat/completions (tools=${(oaPayload.tools || []).length}, stream=${_mode4WasStreaming})`);
        }
      } else {
        console.error(`[hme-proxy] MODE=${_odMode} active but OPENCODE_API_KEY missing -- swap skipped`);
      }
    }

    const upstream = resolveUpstream(clientReq);
    const isAnthropic = upstream.provider === 'anthropic' || _isMode4OmniRoute;

    // Discriminator: only INTERACTIVE-path 429s trip the global escape
    // hatch. OVERDRIVE/loopback callers self-handle via their own circuit
    // breaker; tripping global on them breaks Claude Code's UI.
    const _isInteractivePath = (upstream.provider === 'anthropic' || _isMode4OmniRoute)
      && (typeof clientReq.headers['authorization'] === 'string'
          || typeof clientReq.headers['x-api-key'] === 'string'
          || _isMode4OmniRoute);

    // Hoisted session key: upstream response/error callbacks run outside
    // the `if (payload && messages && !_passthrough)` block.
    const _sessionForTelemetry = (payload ? sessionKey(payload) : 'no-payload');

    const _passthrough = isPassthroughMode();

    if (_passthrough && isAnthropic && _isInteractivePath && payload && Array.isArray(payload.messages)) {
      const _dropped = _shrinkForPassthrough(payload);
      if (_dropped > 0) {
        outBody = Buffer.from(JSON.stringify(payload), 'utf8');
      }
      const _otpmCapRaw = process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
      if (_otpmCapRaw) {
        const _otpmCap = parseInt(_otpmCapRaw, 10);
        const _maxTokensCap = _otpmCap + 2048;
        let _capChanged = false;
        if (payload.thinking && typeof payload.thinking === 'object') {
          if (typeof payload.thinking.budget_tokens === 'number' && payload.thinking.budget_tokens > _otpmCap) {
            console.error(`OTPM-cap (explicit): thinking.budget_tokens ${payload.thinking.budget_tokens} -> ${_otpmCap}`);
            payload.thinking.budget_tokens = _otpmCap;
            _capChanged = true;
          }
        }
        if (typeof payload.max_tokens === 'number' && payload.max_tokens > _maxTokensCap) {
          console.error(`OTPM-cap (explicit): max_tokens ${payload.max_tokens} -> ${_maxTokensCap}`);
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
        try {
          require('./_dump').writeDump(
            payload, require('./shared').PROJECT_ROOT, 'pre',
            (m) => console.warn('Acceptable warning: [middleware]', m),
          );
        } catch (err) {
          console.error(`pre-dump failed: ${err.message}`);
        }
        if (process.env.HME_REPLACE_SYSTEM_PROMPT === '1') {
          if (stripSystemCacheControl(payload)) bodyDirtiedByStrip = true;
        }
        const b = stripBoilerplate(payload);
        const s = stripSemanticRedundancy(payload);
        const r = _stripHmePrefixOutgoing(payload);
        const n = await _injectHmeTools(payload);
        _sanitizePayload(payload);
        if (b > 0 || s > 0 || r || n > 0) bodyDirtiedByStrip = true;
      }

      let scan = null;
      if (isAnthropic) {
        scan = scanMessages(payload);
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
        try {
          const mwDirtied = await middleware.runPipeline(payload, scan, session);
          if (mwDirtied) bodyDirtiedByStrip = true;
        } catch (err) {
          console.error('middleware pipeline error:', err.message);
        }
        if (shouldInject()) {
          const statusBlock = consumeStatusContext(session);
          if (statusBlock) {
            const injectedStatus = injectIntoLastUserMessage(payload, statusBlock.trim(), 'HME Session Status (proxy-injected)');
            if (injectedStatus) {
              emit({ event: 'status_inject', session });
              bodyDirtiedByStrip = true;
            }
          }
          if (scan.jurisdictionTargets.length > 0) {
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
        const ccChanged = normalizeCacheControlTtls(payload);
        if (ccChanged > 0) {
          bodyDirtiedByStrip = true;
          emit({ event: 'cache_control_normalized', session, count: ccChanged });
        }
        if (bodyDirtiedByStrip) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
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
    }

    const upstreamHeaders = { ...clientReq.headers };
    delete upstreamHeaders.host;
    delete upstreamHeaders['content-length'];
    delete upstreamHeaders['x-hme-upstream'];
    upstreamHeaders.host = upstream.host;
    if (outBody.length > 0) upstreamHeaders['content-length'] = String(outBody.length);

    if (isAnthropic) {
      delete upstreamHeaders['accept-encoding'];
    }

    if (isAnthropic && typeof upstreamHeaders['authorization'] === 'string'
        && upstreamHeaders['authorization'].startsWith('Bearer ')) {
      if (!upstreamHeaders['anthropic-beta']) {
        upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
      }
    }

    if (isAnthropic
        && !_isMode4OmniRoute
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
            if (!upstreamHeaders['anthropic-beta']) {
              upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
            }
            console.error(`injected OAuth token for loopback request (path=${clientReq.url})`);
          }
        } catch (_err) {
          console.error(`auth injection failed: ${_err.message}`);
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

    const _isOpusReq = isAnthropic && _isInteractivePath
      && payload && typeof payload.model === 'string'
      && /opus/i.test(payload.model);
    let _releaseOpusSlot = () => {};
    if (_isOpusReq) {
      _releaseOpusSlot = await _acquireOpusSlot();
    }

    const transport = upstream.tls ? https : http;
    const _CONNRETRY_ENABLED = process.env.HME_PROXY_CONNRESET_RETRY === '1';
    const _CONNRETRY_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);
    let _connAttempt = 0;
    let upstreamReq;

    function _spawnUpstream() {
      _connAttempt++;
      upstreamReq = transport.request(upstreamOpts, (upstreamRes) => {
        const ct = (upstreamRes.headers['content-type'] || '').toLowerCase();

        // MODE 4 SWAP RESPONSE HANDLER
if (_isMode4Swap) {
          const { ZenSseTranslator, translateNonStreamResponseToAnthropic } = require('./zen_translator');

          if (upstreamRes.statusCode === 401 || upstreamRes.statusCode === 403) {
             console.error(`MODE=4 AUTH FAILURE: Upstream returned ${upstreamRes.statusCode}. Faking success to protect session.`);
             clientRes.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

             // 1. Send message_start (This fixes the "current message" error)
             clientRes.write('event: message_start\n');
             clientRes.write(`data: {"type":"message_start","message":{"id":"proxy_${Date.now()}","type":"message","role":"assistant","content":[],"model":"deepseek-v4-pro","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`);

             // 2. Send a dummy content block so the UI shows something
             clientRes.write('event: content_block_start\n');
             clientRes.write('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');

             // 3. Close it out
             clientRes.write('event: message_delta\n');
             clientRes.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n');
             clientRes.write('event: message_stop\n');
             clientRes.write('data: {"type":"message_stop"}\n\n');

             return clientRes.end();
          }

if (_mode4WasStreaming) {
            const { ZenSseTranslator } = require('./zen_translator');
            const translator = new ZenSseTranslator({ model: 'deepseek-v4-pro' });
            let _sentStop = false;
            let _sentStart = false;
            let _hasInjectedThinking = false;

            clientRes.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive'
            });

            upstreamRes.on('data', (c) => {
              const translated = translator.feed(c);
              if (!translated) return;

              let output = translated;

              // 1. Opus 4.7 Handshake: Inject thinking block after message_start
              if (!_hasInjectedThinking && output.includes('message_start')) {
                _hasInjectedThinking = true;
                output = output.replace(
                  /("type":"message_start".*?\n\n)/,
                  `$1event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"DeepSeek reasoning..."}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`
                );
              }

              // 2. Shift all subsequent Opus 4.7 blocks (text/tools) to index 1+
              output = output.replace(/"index":(\d+)/g, (match, p1) => {
                return `"index":${parseInt(p1) + 1}`;
              });

              if (output.trim()) {
                if (output.includes('message_start')) _sentStart = true;
                if (output.includes('message_stop')) _sentStop = true;
                clientRes.write(output.endsWith('\n\n') ? output : output + '\n\n');
              }
            });

            upstreamRes.on('end', () => {
              if (!_sentStart) {
                // Force a message_start if we never got one from the stream
                clientRes.write('event: message_start\n');
                clientRes.write(`data: {"type":"message_start","message":{"id":"proxy_${Date.now()}","type":"message","role":"assistant","content":[],"model":"deepseek-v4-pro","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`);
              }
              if (!_sentStop) {
                const finalSequence =
                  'event: message_delta\n' +
                  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n' +
                  'event: message_stop\n' +
                  'data: {"type":"message_stop"}\n\n';
                clientRes.write(finalSequence);
              }
              clientRes.end();
              _releaseOpusSlot();
            });

            upstreamRes.on('error', (err) => {
              _releaseOpusSlot();
              try { clientRes.end(); } catch (_e) {}
            });
          } else {
            const chunks = [];
            upstreamRes.on('data', (c) => chunks.push(c));
            upstreamRes.on('end', () => {
              const buf = Buffer.concat(chunks).toString('utf8');
              let oaBody;
              try { oaBody = JSON.parse(buf); } catch (_e) {
                clientRes.writeHead(502, { 'Content-Type': 'application/json' });
                clientRes.end(JSON.stringify({ error: 'zen response parse failed', raw: buf.slice(0, 500) }));
                _releaseOpusSlot();
                return;
              }
              const anthropicBody = translateNonStreamResponseToAnthropic(oaBody, 'deepseek-v4-pro');
              const body = JSON.stringify(anthropicBody);
              clientRes.writeHead(upstreamRes.statusCode || 200, {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
              });
              clientRes.end(body);
              _releaseOpusSlot();
            });
          }
          return;
        }
        // END MODE 4 SWAP RESPONSE HANDLER

        if (!isAnthropic) {
          clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
          upstreamRes.pipe(clientRes);
          upstreamRes.on('end', _releaseOpusSlot);
          return;
        }

      // Anthropic path: buffer the entire response so we can scan for HME_*
      // tool_uses. If none present, forward buffer + apply SSE transforms
      // (Bash run_in_background rewrite). If HME_* present, run the
      // continuation loop until a final HME-free response, then forward it.
      const chunks = [];

      // FP-CHECK upstream-kill: detect `[FP-CHECK: yes]` in TEXT-block
      // text_delta-only marker scan: bare-substring matched thinking blocks
      // and killed streams when the model reasoned ABOUT the marker. Regex
      // requires `text_delta` and marker in the same SSE event line.
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
              .map((b) => b.text || '').join(' ') || lastUserText;
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
          console.error(`rate-limit headers: limit=${_hdrTokLimit||'?'} remaining=${_hdrTokRemaining||'?'} reset=${_hdrTokReset||'?'} retry-after=${headers['retry-after']||'?'}`);
        }

        // Detect upstream failure: HTTP 4xx JSON error OR HTTP 200 + SSE
        // error event. First-hit escape-hatch trip + LIFESAVER alert +
        // body snapshot. Without SSE coverage, streamed errors bypassed.
        const _proxyMutatedBody = isAnthropic && !_passthrough;
        if (_proxyMutatedBody) {
          const _errInfo = _detectUpstreamFailure(status, headers, fullBody);
          if (_errInfo) {
            const _isOmniRouteErr = _isMode4OmniRoute;
            const _provider = _isOmniRouteErr ? 'omniroute' : 'anthropic';
            const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
            const _errMsg = `${_provider} ${status} ${_errInfo.type || 'error'} [${_pathLabel}]: ${_errInfo.message || '<no message>'}`;
            const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const _snapshotRel = `tmp/claude-${status}-${_pathLabel}-payload-${_stamp}.json`;
            console.error(`UPSTREAM FAILURE detected: ${_errMsg}`);
            // Only INTERACTIVE-path 4xx/5xx trips the global escape hatch.
            // Sub-pipeline failures self-handle via internal circuit breakers;
            // global trip on them puts Claude Code into passthrough.
            const _coolingDown = _alertCooldownActive(_errInfo.type || `http_${status}`, _pathLabel);
            const _shouldRetry = headers['x-should-retry'] === 'true';
            const _isRateLimit = _errInfo.type === 'rate_limit_error';

            // MODE=4/5 OmniRoute fallback: advance to next model in E5 chain on failure.
            console.error(`[hme-proxy] fallback probe: _isMode4OmniRoute=${_isMode4OmniRoute} chainLen=${_swapChain.length} _isRateLimit=${_isRateLimit} status=${status}`);
            if (_isMode4OmniRoute && _swapChain.length > 1) {
              const _fs = require('fs');
              const _pth = require('path');
              const _stFile = _pth.join(PROJECT_ROOT, 'tmp', 'hme-omni-swap-state.json');
              let _st = { idx: 0, ts: 0, fail: 0 };
              try { _st = JSON.parse(_fs.readFileSync(_stFile, 'utf8')); } catch (_) {}
              const _now = Date.now();
              // Advance on failure; reset to start after 5min success window
              if (_st.fail > 0 || _st.ts > 0 && (_now - _st.ts) < 300000) {
                _st.idx = (_st.idx + 1) % _swapChain.length;
              } else {
                _st.idx = 0;
              }
              _st.ts = _now;
              _st.fail++;
              _fs.writeFileSync(_stFile, JSON.stringify(_st));
              const _next = _swapChain[_st.idx];
              const _np = _next.provider === 'codex' ? 'cx' : _next.provider === 'opencode_go' ? 'opencode-go' : 'opencode';
              console.error(`[hme-proxy] MODE=${_odMode} fallback: rate-limited on ${_omniProvider}/${_swapModel} -> advancing to ${_np}/${_next.id} (chain pos ${_st.idx}/${_swapChain.length}, fail count ${_st.fail})`);
            }

            // ITPM-exhaustion bumps panic-shrink so next request is smaller.
            if (_isRateLimit && !_shouldRetry) {
              _consecutive429s = Math.min(_consecutive429s + 1, 4);
              console.error(`rate_limit_error (ITPM-exhaustion) -- panic-shrink counter=${_consecutive429s}, next threshold=${_effectiveCompactThreshold()}B`);
            } else if (_isRateLimit && _shouldRetry) {
              console.error(`rate_limit_error (Cloudflare per-IP throttle) -- skip panic-shrink (size irrelevant)`);
            }
            // Trip escape hatch on every interactive 4xx (incl x-should-retry
            // 429s -- user wants the lifesaver alert as recovery signal).
            // MODE=5: never trip the escape hatch (OmniRoute errors must not
            // cause passthrough to api.anthropic.com).
            if (_isInteractivePath && !_coolingDown && process.env.OVERDRIVE_MODE !== '5') {
              recordUpstreamFailure(_errMsg);
            } else if (_isInteractivePath) {
              console.error(`escape hatch SUPPRESSED (OVERDRIVE_MODE=${process.env.OVERDRIVE_MODE || '0'}, _isMode4OmniRoute=${_isMode4OmniRoute}) -- passthrough blocked`);
            } else if (!_isInteractivePath) {
              console.error(`sub-pipeline failure -- NOT tripping escape hatch (interactive path unaffected)`);
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
              console.error(`payload snapshotted to ${outFile}`);
              // Skip lifesaver for sub-pipeline 404 probes + cooldown dupes.
              // x-should-retry 429s DO alert (user-visible recovery signal).
              const _suppressLifesaver = _coolingDown
                || (status === 404 && _pathLabel === 'sub-pipeline');
              if (!_suppressLifesaver) {
                const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
                fs.appendFileSync(errLog,
                  `[${_stamp}] UPSTREAM_${status}_${_pathLabel.toUpperCase()}: ${_errMsg} (request_id=${_errInfo.requestId || '?'}, snapshot=${_snapshotRel})\n`);
              }
            } catch (err) {
              console.error(`snapshot/lifesaver write failed: ${err.message}`);
            }
            emit({ event: 'upstream_error', session: _sessionForTelemetry, status, type: _errInfo.type, message: _errInfo.message, path_label: _pathLabel });
            // No retry on 429: Cloudflare's sustained throttle window means
            // retries extend it.
            const _isBearerAuth = typeof upstreamHeaders['authorization'] === 'string'
              && upstreamHeaders['authorization'].startsWith('Bearer ');
            if (status === 401 && _isBearerAuth && payload && Array.isArray(payload.messages)) {
              try {
                console.error('got 401, attempting token refresh + retry');
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
                console.error(`401-retry response: ${retry.statusCode}`);
                if (retry.statusCode >= 200 && retry.statusCode < 300) {
                  status = retry.statusCode;
                  headers = retry.headers;
                  fullBody = retry.body;
                  recordUpstreamSuccess();
                }
              } catch (refreshErr) {
                console.error(`401-refresh failed: ${refreshErr.message}`);
              }
            }
          } else {
            recordUpstreamSuccess();
            if (_consecutive429s > 0) {
              console.error(`success -- resetting panic-shrink counter (was ${_consecutive429s})`);
              _consecutive429s = 0;
            }
          }
        } else if (status >= 200 && status < 300) {
          recordUpstreamSuccess();
          if (_consecutive429s > 0) {
            console.error(`success -- resetting panic-shrink counter (was ${_consecutive429s})`);
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
              (headers['content-type'] || '').toLowerCase().includes('text/event-stream'),
            );
          } catch (err) {
            console.error('HME continuation failed:', err.message);
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

        // EXHAUSTIVE RESPONSE DUMPER: complete bodies/headers/events per
        // transaction. Rotates last 200; each dump self-contained.
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

          // MODE=4/5 OmniRoute: blank -> retry next model transparently.
          if (_isBlank && _isMode4OmniRoute && _swapChain.length > 1) {
            const _fs3 = require('fs');
            const _pth3 = require('path');
            const _stFile3 = _pth3.join(PROJECT_ROOT, 'tmp', 'hme-omni-swap-state.json');
            let _st3 = { idx: 0 };
            try { _st3 = JSON.parse(_fs3.readFileSync(_stFile3, 'utf8')); } catch (_) {}

            // Walk remaining chain models (sync, non-streaming)
            for (let _ri = 1; _ri < _swapChain.length; _ri++) {
              const _try = _swapChain[(_st3.idx + _ri) % _swapChain.length];
              const _tp = _try.provider === 'codex' ? 'cx' : _try.provider === 'opencode_go' ? 'opencode-go' : 'opencode';
              let _tid = _try.id;
              if (_tid.endsWith('-go')) _tid = _tid.slice(0, -3);
              const _rp = JSON.parse(JSON.stringify(payload));
              _rp.model = `${_tp}/${_tid}`;
              _rp.stream = false;
              console.error(`[hme-proxy] BLANK retry ${_ri}: ${_omniProvider}/${_swapModel} -> ${_tp}/${_tid}`);
              try {
                const _rRes = await new Promise((resolve, reject) => {
                  const _rr = transport.request({ ...upstreamOpts, headers: { ...upstreamHeaders, 'content-length': String(Buffer.byteLength(JSON.stringify(_rp))) } }, (res) => {
                    const _cs = []; res.on('data', c => _cs.push(c));
                    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(_cs).toString('utf8') }));
                    res.on('error', reject);
                  });
                  _rr.on('error', reject);
                  _rr.write(JSON.stringify(_rp));
                  _rr.end();
                });
                if (_rRes.status >= 200 && _rRes.status < 300) {
                  try {
                    const _rj = JSON.parse(_rRes.body);
                    if (_rj.content && _rj.content.length > 0) {
                      const _rt = _rj.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
                      if (_rt) {
                        _st3.idx = (_st3.idx + _ri) % _swapChain.length;
                        _st3.ts = Date.now();
                        _st3.fail = 0;
                        _fs3.writeFileSync(_stFile3, JSON.stringify(_st3));
                        outStatus = _rRes.status;
                        outBuf = Buffer.from(_rRes.body);
                        outHeaders['content-type'] = 'application/json';
                        delete outHeaders['transfer-encoding'];
                        console.error(`[hme-proxy] BLANK retry OK: ${_tp}/${_tid} -> "${_rt.slice(0, 60)}"`);
                        break;
                      }
                    }
                  } catch (_) {}
                }
                console.error(`[hme-proxy] BLANK retry ${_tp}/${_tid}: still no content`);
              } catch (_re) { console.error(`[hme-proxy] BLANK retry error: ${_re.message}`); }
            }
          }

          const _ts = new Date().toISOString().replace(/[:.]/g, '-');
          const _path_label = _isInteractivePath ? 'interactive' : 'sub';
          const _corrId = `${_ts}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
          const _dumpFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.json`);
          const _bodyFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.body`);
          const _reqBodyFile = _bdPath.join(_dumpDir, `hme-resp-${_corrId}-${_verdict}-${_path_label}.reqBody`);
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
            console.error(`dump ${_verdict}/${_path_label} status=${outStatus} sse=${_isSse} textC=${_textChars} thC=${_thinkingChars} blocks=${_textBlocks}t/${_thinkingBlocks}th/${_toolUseBlocks}tu stop=${_stopReason} bodyB=${outBuf.length} reqB=${outBody.length} -> ${_dumpFile}`);
          } catch (_e) { console.error(`dump write failed: ${_e.message} stack=${_e.stack}`); }
        } catch (_e) {
          if (_e && _e.message === 'skip-non-anthropic') { /* expected */ }
          else { console.error(`response-trace dumper threw: ${_e.message} stack=${_e.stack}`); }
        }

        // Strip content-length on ANY SSE-mutation path. SseTransform
        // changes byte count; stale CL stalls or truncates the client.
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
          const { runInBackgroundRewrite, longLeadingSleepRewrite, ackStripRewrite, slopStripRewrite, hallucinatedTurnPrefixStripRewrite, stopHookCeremonyStripRewrite, fpGateMarkerRewrite, soloRationaleTrimRewrite } = require('./sse_rewriters');
          // Order: longLeadingSleep rewrites BEFORE runInBackground reads
          // (both keyed by content-block index for consistent state).
          // Chain order is encoded in the rewriters[] array below.
          const xform = new SseTransform({
            // fpGateMarker FIRST -- handles [FP-CHECK: yes/no] marker (yes ->
            // truncate to `.`; no -> strip marker line). soloRationaleTrim
            // LAST -- surgical trim of trailing rationale paragraph.
            rewriters: [fpGateMarkerRewrite, stopHookCeremonyStripRewrite, hallucinatedTurnPrefixStripRewrite, longLeadingSleepRewrite, runInBackgroundRewrite, ackStripRewrite, slopStripRewrite, soloRationaleTrimRewrite],
          });
          // Populate priorUserWasDeny flag for the ack-strip rewriter:
          // last user message matches a hook-deny payload marker.
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
              const fs = require('fs');
              const path = require('path');
              fs.appendFileSync(
                path.join(PROJECT_ROOT, 'log', 'hme-proxy-ackstrip.log'),
                `[${new Date().toISOString()}] sse-setup priorUserWasDeny=${_denyHit} lastUserHead=${JSON.stringify(lastUserText.slice(0,80))}\n`,
              );
            } catch (_e) { /* best-effort */ }
          } catch (_e) { /* best-effort */ }
          xform.pipe(clientRes);
          xform.end(outBuf);
        } else {
          // Non-streaming: scan body for bare-ack text blocks; emit a
          // LIFESAVER entry on detection so next turn sees it. Strip also
          // runs when conditions match (defense in depth).
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
                  // Stat-only -- write to a SEPARATE log (mirrors SSE-path
                  // policy in sse_rewriters.js). Strip is the cure; logging
                  // to errors.log re-fired the alert every turn.
                  try {
                    const fs = require('fs');
                    const path = require('path');
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
        // Stop-hook fallback (post-response, after recent /hme/lifecycle Stop
        // miss): only fire when final assistant message has no tool_use --
        // approximates real turn end and avoids mid-turn retrigger.
        const _hasToolUse = (() => {
          try {
            // Non-streaming: outBuf is the JSON message with .content blocks.
            // Parse-fail defaults to no-tool-use so the fallback still fires.
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
            console.error('inline Stop threw:', e.message);
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
        console.error(`upstream read error: ${_errMsg}`);
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
    // 30-min upstream timeout: covers worst-case multi-MB `claude --resume`
    // turnaround. claude's own subprocess timeout is the tighter bound
    // (buddy_handoff.py cmd_consult); proxy is not the throttle.
    const UPSTREAM_TIMEOUT_MS = 1_800_000;
    upstreamReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      console.error(`upstream timeout (${isStreaming ? 'streaming' : 'sync'})`);
      try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
      upstreamReq.destroy(new Error('upstream timeout'));
    });

    upstreamReq.on('error', (err) => {
      try { _releaseOpusSlot(); } catch (_e) { /* ignore */ }
      const _errCode = err.code || 'unknown';
      const _pathLabel = _isInteractivePath ? 'interactive' : 'sub-pipeline';
      // Single-shot retry: env-gated, retryable code, pre-headers, first attempt only.
      if (_CONNRETRY_ENABLED && _isInteractivePath && _connAttempt === 1
          && !clientRes.headersSent && _CONNRETRY_CODES.has(_errCode)) {
        console.error(`${_errCode} -- single retry (HME_PROXY_CONNRESET_RETRY=1)`);
        return _spawnUpstream();
      }
      const _errMsg = `upstream ${_errCode} [${_pathLabel}]: ${err.message}`;
      console.error(`upstream connection error: ${_errMsg}`);
      if (_isInteractivePath) {
        recordUpstreamFailure(_errMsg);
      } else {
        console.error('sub-pipeline conn-error -- NOT tripping escape hatch');
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
        console.error(`conn-error snapshot/lifesaver write failed: ${snapErr.message}`);
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
    } // _spawnUpstream
    _spawnUpstream();
  });

  clientReq.on('error', (err) => {
    console.error('client error:', err.message);
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
    console.error('listen error:', err.message);
    process.exit(1);
  });
}
