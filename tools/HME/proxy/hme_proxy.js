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

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const EMIT_PY = path.join(PROJECT_ROOT, 'tools/HME/activity/emit.py');
const PORT = parseInt(process.env.HME_PROXY_PORT || '9099', 10);
// Default upstream for Claude Code (ANTHROPIC_BASE_URL points here).
const DEFAULT_UPSTREAM_HOST = process.env.HME_PROXY_UPSTREAM_HOST || 'api.anthropic.com';
const DEFAULT_UPSTREAM_PORT = parseInt(process.env.HME_PROXY_UPSTREAM_PORT || '443', 10);
const DEFAULT_UPSTREAM_TLS = (process.env.HME_PROXY_UPSTREAM_TLS ?? '1') !== '0';
// Injection is on by default; disable with HME_PROXY_INJECT=0 for pure observability.
const INJECT = (process.env.HME_PROXY_INJECT ?? '1') !== '0';

// ── Multi-upstream routing ──────────────────────────────────────────────────
// Callers pass `X-HME-Upstream: https://api.groq.com` (or any full URL) to
// route through a non-default upstream. The proxy resolves host/port/TLS from
// the URL. Claude Code calls omit this header and hit the Anthropic default.
// HME synthesis modules set it to route their provider calls through the proxy.
function resolveUpstream(req) {
  const header = req.headers['x-hme-upstream'];
  if (!header) {
    return { host: DEFAULT_UPSTREAM_HOST, port: DEFAULT_UPSTREAM_PORT, tls: DEFAULT_UPSTREAM_TLS, provider: 'anthropic' };
  }
  try {
    const u = new URL(header.startsWith('http') ? header : `https://${header}`);
    const tls = u.protocol === 'https:';
    const port = u.port ? parseInt(u.port, 10) : (tls ? 443 : 80);
    // Derive a short provider label for logging
    const hostParts = u.hostname.split('.');
    const provider = hostParts.length >= 2 ? hostParts[hostParts.length - 2] : u.hostname;
    return { host: u.hostname, port, tls, provider, basePath: u.pathname !== '/' ? u.pathname : '' };
  } catch (_err) {
    return { host: DEFAULT_UPSTREAM_HOST, port: DEFAULT_UPSTREAM_PORT, tls: DEFAULT_UPSTREAM_TLS, provider: 'anthropic' };
  }
}

// ── Emergency valve ─────────────────────────────────────────────────────────
// If the proxy causes N consecutive upstream failures (connection refused,
// timeout, DNS failure), it is BLOCKING the user's connection to Claude.
// The valve fires: writes a CRITICAL alert to hme-errors.log, flips
// HME_PROXY_ENABLED=0 in .env, and kills itself. Claude Code retries the
// request and hits Anthropic directly (ANTHROPIC_BASE_URL env survives the
// proxy death but the next sessionstart won't relaunch it).
const EMERGENCY_THRESHOLD = 3;
let _consecutiveFailures = 0;
let _valveTripped = false;

function tripEmergencyValve(lastErr) {
  if (_valveTripped) return;
  _valveTripped = true;
  const msg = `EMERGENCY VALVE: proxy killed after ${EMERGENCY_THRESHOLD} consecutive upstream failures. Last error: ${lastErr}. HME_PROXY_ENABLED set to 0.`;
  console.error(`[hme-proxy] ${msg}`);

  // Write to LIFESAVER error log so the agent sees it immediately
  const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(errLog, `[${ts}] PROXY_EMERGENCY: ${msg}\n`);
  } catch (_e) { /* best effort */ }

  // Flip HME_PROXY_ENABLED=0 in .env so sessionstart won't restart us
  const envPath = path.join(PROJECT_ROOT, '.env');
  try {
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(
      /^HME_PROXY_ENABLED=.*/m,
      'HME_PROXY_ENABLED=0  # EMERGENCY VALVE tripped — proxy self-disabled',
    );
    fs.writeFileSync(envPath, envContent);
  } catch (_e) {
    console.error('[hme-proxy] WARNING: could not update .env — manually set HME_PROXY_ENABLED=0');
  }

  // Emit activity event
  emit({ event: 'proxy_emergency', reason: lastErr, source: 'emergency_valve' });

  // Shut down after a brief delay so the current 502 response can flush
  setTimeout(() => process.exit(99), 500);
}

function recordUpstreamSuccess() {
  _consecutiveFailures = 0;
}

function recordUpstreamFailure(err) {
  _consecutiveFailures++;
  if (_consecutiveFailures >= EMERGENCY_THRESHOLD) {
    tripEmergencyValve(err);
  }
}

// ── Coherence budget gating ─────────────────────────────────────────────────
// When coherence is ABOVE the budget band, the system is too disciplined —
// relax injection to allow exploration. When BELOW, tighten. When IN band,
// inject normally. The budget file is written by compute-coherence-score.js
// each pipeline run.
const COHERENCE_BUDGET_PATH = path.join(PROJECT_ROOT, 'metrics', 'hme-coherence-budget.json');
let _budgetState = null;  // 'below' | 'in_band' | 'above' | null
let _budgetLoadedAt = 0;
// Shared refresh cadence for all file-backed caches below (budget, bias
// bounds, staleness, hypotheses). Declared here so every consumer sees
// the binding at parse time (no TDZ risk if a consumer fires during
// module-init before the former declaration site was reached).
const REFRESH_INTERVAL_MS = 60_000;

function loadCoherenceBudget() {
  const now = Date.now();
  if (_budgetState !== null && now - _budgetLoadedAt < REFRESH_INTERVAL_MS) return _budgetState;
  try {
    const raw = fs.readFileSync(COHERENCE_BUDGET_PATH, 'utf8');
    const data = JSON.parse(raw);
    const score = data.current_coherence;
    const band = data.band; // [lo, hi]
    if (typeof score === 'number' && Array.isArray(band) && band.length === 2) {
      if (score < band[0]) _budgetState = 'below';
      else if (score > band[1]) _budgetState = 'above';
      else _budgetState = 'in_band';
    }
  } catch (_err) {
    _budgetState = 'in_band'; // default: inject normally
  }
  _budgetLoadedAt = now;
  return _budgetState;
}

function shouldInject() {
  if (!INJECT) return false;
  const budget = loadCoherenceBudget();
  // ABOVE band = too disciplined → suppress injection, allow exploration
  if (budget === 'above') return false;
  return true;
}

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
const HYPOTHESES_PATH = path.join(PROJECT_ROOT, 'metrics/hme-hypotheses.json');
const DRIFT_PATH = path.join(PROJECT_ROOT, 'metrics/hme-semantic-drift.json');
const JURISDICTION_ZONES = [
  'src/conductor/signal/meta/',
  'src/conductor/signal/profiling/',
];
let _biasByFile = null;
let _biasLoadedAt = 0;
let _stalenessByModule = null;
let _stalenessLoadedAt = 0;
let _openHypothesesByModule = null;
let _hypothesesLoadedAt = 0;
let _driftByModule = null;
let _driftLoadedAt = 0;
// REFRESH_INTERVAL_MS is declared near the top of the file (above
// loadCoherenceBudget) so all file-backed cache consumers share one
// binding without TDZ risk.

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

function loadOpenHypothesesMap() {
  // Phase 3.1 extension: surface OPEN hypotheses for modules in scope.
  const now = Date.now();
  if (_openHypothesesByModule && now - _hypothesesLoadedAt < REFRESH_INTERVAL_MS) {
    return _openHypothesesByModule;
  }
  _openHypothesesByModule = new Map();
  try {
    const raw = fs.readFileSync(HYPOTHESES_PATH, 'utf8');
    const data = JSON.parse(raw);
    for (const h of data.hypotheses || []) {
      if (h.status !== 'OPEN') continue;
      for (const mod of h.modules || []) {
        const arr = _openHypothesesByModule.get(mod) || [];
        arr.push(h);
        _openHypothesesByModule.set(mod, arr);
      }
    }
  } catch (_err) {
    // no registry yet
  }
  _hypothesesLoadedAt = now;
  return _openHypothesesByModule;
}

function loadDriftMap() {
  // Phase 3.3 extension: surface semantic drift warnings for modules in scope.
  const now = Date.now();
  if (_driftByModule && now - _driftLoadedAt < REFRESH_INTERVAL_MS) {
    return _driftByModule;
  }
  _driftByModule = new Map();
  try {
    const raw = fs.readFileSync(DRIFT_PATH, 'utf8');
    const data = JSON.parse(raw);
    for (const d of data.drifted_entries || []) {
      if (d.module) _driftByModule.set(d.module, d);
    }
  } catch (_err) {
    // no drift report yet
  }
  _driftLoadedAt = now;
  return _driftByModule;
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
  // Phase 3: also flag files that have OPEN hypotheses or drift warnings.
  const stem = path.basename(filePath, path.extname(filePath));
  const hyp = loadOpenHypothesesMap();
  if (hyp.has(stem)) return true;
  const drift = loadDriftMap();
  if (drift.has(stem)) return true;
  return false;
}

function buildJurisdictionContext(filePaths) {
  if (!filePaths || filePaths.length === 0) return null;
  const biasMap = loadBiasManifest();
  const staleMap = loadStalenessMap();
  const hypMap = loadOpenHypothesesMap();
  const driftMap = loadDriftMap();
  const lines = [];
  let anyMatched = false;
  for (const fp of filePaths) {
    // Normalize to the "src/..." form the manifest uses
    const idx = fp.indexOf('src/');
    const rel = idx >= 0 ? fp.slice(idx) : fp;
    const stem = path.basename(rel, path.extname(rel));
    const bias = biasMap.get(rel) || [];
    const stale = staleMap.get(stem);
    const hypotheses = hypMap.get(stem) || [];
    const drifted = driftMap.get(stem);
    const inZone = JURISDICTION_ZONES.some((z) => rel.includes(z));
    if (!inZone && bias.length === 0 && !stale && hypotheses.length === 0 && !drifted) continue;
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
    if (hypotheses.length > 0) {
      lines.push(`- Open hypotheses (${hypotheses.length}) — this edit may confirm or refute:`);
      for (const h of hypotheses.slice(0, 4)) {
        lines.push(`    \`${h.id}\`: ${String(h.claim || '').slice(0, 140)}`);
        lines.push(`      falsifier: ${String(h.falsification || '').slice(0, 120)}`);
      }
      if (hypotheses.length > 4) {
        lines.push(`    … (+${hypotheses.length - 4} more)`);
      }
    }
    if (drifted) {
      const fieldsChanged = (drifted.diffs || [])
        .filter((d) => d.field !== 'content_hash_prefix')
        .map((d) => d.field);
      lines.push(
        `- ⚠ KB semantic drift: the baseline signature for this module has diverged ` +
          `(${fieldsChanged.length} structural field(s): ${fieldsChanged.slice(0, 4).join(', ')}). ` +
          `KB description may be wrong.`,
      );
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
    '  node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds',
    '',
    'If a drifted KB entry is shown, re-capture its signature after updating the description:',
    '  python3 scripts/pipeline/hme/capture-kb-signatures.py',
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

// ── Boilerplate stub stripper ───────────────────────────────────────────────
// Claude Code injects fixed strings into tool_result content for native
// tools: `(Bash completed with no output)`, `The file X has been updated
// successfully. ...`, `Stop hook feedback: ... : ok`, and repeating
// TodoWrite nags. These strings are signalless to Claude — they're
// acknowledgement tokens from the harness, not information. Strip them
// from the in-flight payload.messages array so Claude's context isn't
// polluted with hundreds of them per session.
//
// PRECISION GUARDRAILS:
//   - Each pattern is a NAMED exact/tight regex (no fuzzy match).
//   - We only strip text-type content blocks or the whole tool_result
//     block if its content is entirely boilerplate.
//   - Every strip emits an activity event `boilerplate_stripped` with
//     the pattern name, byte count, and sample prefix so anything
//     accidentally matched is auditable after the fact.
//   - Runs BEFORE scanMessages so the scanner sees the cleaned payload.
const BOILERPLATE_PATTERNS = [
  {
    name: 'bash_no_output',
    // Literal harness stub — exact match only.
    re: /^\(Bash completed with no output\)\s*$/,
    strip_whole_block: true,
  },
  {
    name: 'edit_success_stub',
    // `The file <path> has been updated successfully. (file state is current in your context — no need to Read it back)`
    re: /^The file \/\S+ has been updated successfully\. \(file state is current in your context[^)]*\)\s*$/,
    strip_whole_block: true,
  },
  {
    name: 'stop_hook_ok',
    // `Stop hook feedback:\n[bash ...lifecycle/stop.sh]: ok`
    // Only strip the "ok" variant — fail=N carries real signal.
    re: /^Stop hook feedback:\s*\n\[bash [^\]]*stop\.sh\]:\s*ok\s*$/,
    strip_whole_block: true,
  },
  {
    name: 'todowrite_nag',
    // `<system-reminder>\nThe TodoWrite tool hasn't been used recently. ... </system-reminder>`
    re: /<system-reminder>\s*The TodoWrite tool hasn't been used recently[\s\S]*?<\/system-reminder>/,
    strip_whole_block: false, // strip only the reminder span, keep surrounding text
  },
];

function _isBoilerplateText(text) {
  for (const p of BOILERPLATE_PATTERNS) {
    if (p.strip_whole_block && p.re.test(text || '')) {
      return { match: true, pattern: p };
    }
  }
  return { match: false };
}

function stripBoilerplate(payload) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  let strippedCount = 0;
  const stripped_samples = {};
  for (const msg of payload.messages) {
    if (!msg || !Array.isArray(msg.content)) continue;
    const keepBlocks = [];
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') {
        keepBlocks.push(block);
        continue;
      }
      // Whole-block strip: tool_result / text blocks whose entire content
      // matches an exact boilerplate pattern.
      let blockText = '';
      if (block.type === 'text') {
        blockText = typeof block.text === 'string' ? block.text : '';
      } else if (block.type === 'tool_result') {
        const c = block.content;
        if (typeof c === 'string') blockText = c;
        else if (Array.isArray(c)) {
          // content can be array of {type:text,text:...} — join text parts
          blockText = c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
        }
      }
      const hit = _isBoilerplateText(blockText);
      if (hit.match) {
        strippedCount++;
        stripped_samples[hit.pattern.name] = (stripped_samples[hit.pattern.name] || 0) + 1;
        continue; // drop the block
      }
      // In-block regex strip (for patterns that should only remove a
      // sub-span, e.g. repeating todowrite_nag inside a mixed message).
      if (block.type === 'text' && typeof block.text === 'string') {
        let modified = block.text;
        for (const p of BOILERPLATE_PATTERNS) {
          if (p.strip_whole_block) continue;
          const before = modified.length;
          modified = modified.replace(p.re, '');
          if (modified.length !== before) {
            strippedCount++;
            stripped_samples[p.name] = (stripped_samples[p.name] || 0) + 1;
          }
        }
        block.text = modified;
      }
      keepBlocks.push(block);
    }
    msg.content = keepBlocks;
  }
  if (strippedCount > 0) {
    const samples_str = Object.entries(stripped_samples).map(([k, v]) => `${k}=${v}`).join(',');
    emit({
      event: 'boilerplate_stripped',
      session: 'proxy',
      count: strippedCount,
      patterns: samples_str,
    });
  }
  return strippedCount;
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
  // KB-briefing evidence: the pretooluse_edit hook injects a
  // `KB CONSTRAINTS for <module>` / `KB CONTEXT for <module>` string via
  // hookSpecificOutput.additionalContext, which Claude Code surfaces in
  // a subsequent user-role text block. If that text appears in ANY prior
  // message, the auto-briefing chain has satisfied the pre-edit
  // precondition just as explicitly as mcp__HME__read would have.
  const KB_BRIEFING_RE = /KB (CONSTRAINTS|CONTEXT) for \w/;
  let lastAssistantTools = [];
  for (const m of msgs) {
    const content = m && m.content;
    if (!Array.isArray(content)) continue;
    const toolsInMsg = [];
    for (const block of content) {
      if (!block) continue;
      // Scan text/tool_result content for hook-injected briefing markers.
      if (block.type === 'text' || block.type === 'tool_result') {
        const txt = typeof block.text === 'string' ? block.text
                   : typeof block.content === 'string' ? block.content
                   : '';
        if (txt && KB_BRIEFING_RE.test(txt)) {
          result.hmeReadCalled = true;
        }
      }
      if (block.type !== 'tool_use') continue;
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
  if (clientReq.url === '/health') {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }
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

    // Resolve provider for logging + conditional scanning
    const upstream = resolveUpstream(clientReq);
    const isAnthropic = upstream.provider === 'anthropic';

    if (payload && Array.isArray(payload.messages)) {
      const session = sessionKey(payload);

      // Boilerplate stub strip (Anthropic only — our message format). Runs
      // BEFORE scanMessages so the scanner sees the cleaned payload, and
      // mutates the payload in place so the upstream request carries the
      // reduced history. If any blocks were stripped we re-serialize below.
      let bodyDirtiedByStrip = false;
      if (isAnthropic) {
        const strippedN = stripBoilerplate(payload);
        if (strippedN > 0) bodyDirtiedByStrip = true;
      }

      // Coherence scanning + jurisdiction injection: Anthropic only.
      // These inspect the Evolver's tool_use history, which only exists in
      // Anthropic message format. Provider calls (Groq, Gemini, etc.) are
      // HME synthesis — they don't carry Evolver tool history.
      // `scan` hoisted to function scope so the reflexivity emit below can
      // reference it outside the isAnthropic block. scanMessages only runs
      // for Anthropic payloads (provider calls have no Evolver history).
      let scan = null;
      if (isAnthropic) {
        scan = scanMessages(payload);
        if (shouldInject() && scan.jurisdictionTargets.length > 0) {
          const block = buildJurisdictionContext(scan.jurisdictionTargets);
          injected = injectIntoSystem(payload, block);
          if (injected) {
            emit({
              event: 'jurisdiction_inject',
              session,
              targets: scan.jurisdictionTargets.length,
              first_target: (scan.jurisdictionTargets[0] || '').replace(/[,=\s]/g, '_'),
            });
            bodyDirtiedByStrip = true; // share re-serialize path
          }
        }
        if (bodyDirtiedByStrip) {
          outBody = Buffer.from(JSON.stringify(payload), 'utf8');
        }
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

      // Log every inference call regardless of provider
      emit({
        event: 'inference_call',
        session,
        provider: upstream.provider,
        path: clientReq.url || '?',
        model: (payload.model || 'unknown').replace(/[,=\s]/g, '_'),
        messages: payload.messages.length,
        injected: injected,
      });

      // Reflexivity: if we injected last time and the Evolver's next turn
      // shows a tool call, track whether it was consistent with the injection.
      // This is the behavioral influence signal — did HME's context actually
      // change what the Evolver did?
      if (isAnthropic && injected && scan) {
        emit({
          event: 'injection_influence',
          session,
          injection_type: 'jurisdiction',
          targets_count: scan.jurisdictionTargets.length,
        });
      }
    }

    // Forward upstream using the already-resolved target.
    const upstreamHeaders = { ...clientReq.headers };
    delete upstreamHeaders.host;
    delete upstreamHeaders['content-length'];
    delete upstreamHeaders['x-hme-upstream']; // don't leak routing header
    upstreamHeaders.host = upstream.host;
    if (outBody.length > 0) {
      upstreamHeaders['content-length'] = String(outBody.length);
    }

    // If the upstream header carried a base path (e.g. https://api.groq.com/openai)
    // prepend it to the request path so /v1/chat/completions → /openai/v1/chat/completions.
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
      // Upstream responded — connection is alive. Reset failure counter.
      recordUpstreamSuccess();
      // Pass through status + headers, then pipe streaming body verbatim.
      // SSE frames from Anthropic flow through without buffering, preserving
      // token latency. Transfer-Encoding and content-type headers are forwarded
      // as-is so text/event-stream + chunked encoding work transparently.
      clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    });

    // Upstream socket timeout: 10 min for streaming, 2 min for non-streaming.
    // Anthropic's streaming responses can run for minutes on long completions.
    const isStreaming = payload && payload.stream === true;
    upstreamReq.setTimeout(isStreaming ? 600_000 : 120_000, () => {
      console.error(`[hme-proxy] upstream timeout (${isStreaming ? 'streaming' : 'sync'})`);
      upstreamReq.destroy(new Error('upstream timeout'));
    });

    upstreamReq.on('error', (err) => {
      console.error('[hme-proxy] upstream error:', err.message);
      // Track consecutive connection-level failures (not HTTP errors — those
      // are successful connections with error status codes, handled above).
      recordUpstreamFailure(err.message);
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
    const scheme = DEFAULT_UPSTREAM_TLS ? 'https' : 'http';
    console.log(
      `hme-proxy listening on http://127.0.0.1:${PORT}`,
    );
    console.log(`  default upstream: ${scheme}://${DEFAULT_UPSTREAM_HOST}:${DEFAULT_UPSTREAM_PORT} (Anthropic)`);
    console.log(`  multi-upstream: X-HME-Upstream header routes to any provider`);
    console.log(`  emit → ${EMIT_PY}`);
  });
  server.on('error', (err) => {
    console.error('[hme-proxy] listen error:', err.message);
    process.exit(1);
  });
}
