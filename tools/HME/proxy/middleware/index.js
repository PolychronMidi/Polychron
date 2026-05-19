'use strict';
/**
 * Proxy middleware pipeline.
 *
 * Shell hooks that fire on Claude-native tool calls (Edit, Write, Read, Bash,
 * etc.) have moved here. They fire once per request, driven by reconstructing
 * "tool execution events" from the message history: each tool_result block
 * gets paired with the corresponding tool_use block by id.
 *
 * Each middleware module exports:
 *   - name: string
 *   - onToolResult?({ toolUse, toolResult, session, ctx })
 *       Fired once per completed tool execution (paired tool_use + tool_result).
 *       Deduplicated by tool_use.id across the process lifetime.
 *   - onRequest?({ payload, scan, session, ctx })
 *       Fired on every Anthropic request after strip + scan, before inject.
 *
 * ctx exposes:
 *   - emit(fields)                        -- activity event via emit.py
 *   - nexusAdd/Mark/ClearType/Has/Count   -- tmp/hme-nexus.state operations
 *   - warn(msg)                           -- log to stderr with [middleware] prefix
 *   - markDirty()                         -- signal payload needs re-serialize
 *   - hasHmeFooter(result, marker)        -- idempotency guard for enrichment
 *   - appendToResult(result, text)        -- append text to tool_result (any shape)
 *   - replaceResult(result, text)         -- REPLACE tool_result content entirely
 *                                           (use when authoritative real output
 *                                           supersedes a stub, e.g. background
 *                                           task resolution)
 *   - retryNextTurn(toolUseId)            -- remove dedup so middleware re-enters
 *                                           on a future turn; bounded by
 *                                           _MAX_RETRIES to avoid infinite loops
 *   - retryAttempt(toolUseId)             -- how many retries so far (0 = first)
 *   - retriesRemaining(toolUseId)         -- remaining budget before permanent
 *                                           pass-through
 */

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('../shared');

const NEXUS_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-nexus.state');
const PHASES_FILE = path.join(__dirname, 'phases.json');

function _ensureDir(p) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (_e) { /* ignore */ }
}

function nexusAdd(type, payload) {
  _ensureDir(NEXUS_FILE);
  const line = `${type}:${Math.floor(Date.now() / 1000)}:${payload || ''}\n`;
  try { fs.appendFileSync(NEXUS_FILE, line); } catch (err) {
    console.error(`[middleware] nexusAdd ${type} failed: ${err.message}`);
  }
}

// nexusClearType audit: emits caller module + restart-suspicion flag to
// activity stream every clear. Catches silent-EDIT-clear bug class.
const _PROCESS_BOOT_TS = Date.now();
const _RESTART_SUSPICION_WINDOW_MS = 60_000;

function _callerModule() {
  // Walk the stack until we find a frame inside middleware/<mod>.js. Best-
  // effort; the captured stack format varies across Node versions but the
  // common shape `at fn (.../middleware/foo.js:NN)` parses reliably.
  const err = new Error();
  const stack = err.stack || '';
  const re = /\/middleware\/([A-Za-z_][A-Za-z0-9_]*)\.js[:\)]/g;
  let match;
  let last = 'unknown';
  while ((match = re.exec(stack)) !== null) {
    if (match[1] !== 'index') last = match[1];
  }
  return last;
}

function nexusClearType(type) {
  _ensureDir(NEXUS_FILE);
  let removed = 0;
  let beforeCount = 0;
  try {
    if (!fs.existsSync(NEXUS_FILE)) return;
    const lines = fs.readFileSync(NEXUS_FILE, 'utf8').split('\n');
    beforeCount = lines.filter((l) => l && l.startsWith(`${type}:`)).length;
    const kept = lines.filter((l) => l && !l.startsWith(`${type}:`));
    removed = beforeCount;
    fs.writeFileSync(NEXUS_FILE, kept.join('\n') + (kept.length ? '\n' : ''));
  } catch (err) {
    console.error(`[middleware] nexusClearType ${type} failed: ${err.message}`);
    return;
  }
  if (removed === 0) return;  // no audit event for no-op clears

  const caller = _callerModule();
  const sinceBootMs = Date.now() - _PROCESS_BOOT_TS;
  const isSuspicious = sinceBootMs < _RESTART_SUSPICION_WINDOW_MS;
  // Activity stream: always emit so the audit trail is complete.
  // Horizon VII instrumentation: caused_by = the JS module that called
  // _nexus_clear (resolved via _callerModule from stack inspection).
  // Lets `i/why mode=causality nexus_cleared` resolve via Tier-1.5.
  try {
    emit({
      event: 'nexus_cleared',
      type,
      removed,
      caller,
      caused_by: caller || 'unknown',
      since_boot_ms: sinceBootMs,
      suspicious: isSuspicious,
    });
  } catch (_e) { /* best-effort */ }

  // LIFESAVER channel: only when the heuristic flags a clear inside the
  // restart-suspicion window AND removed >0 entries from a state-tracking
  // type (EDIT is the canonical user-visible one). Tunable via env var
  // for noise-suppression in known-clean operations.
  if (
    isSuspicious
    && type === 'EDIT'
    && process.env.HME_NEXUS_AUDIT_SILENCE !== '1'
  ) {
    try {
      const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
      _ensureDir(errLog);
      const ts = new Date().toISOString();
      fs.appendFileSync(
        errLog,
        `[${ts}] [nexus-audit] suspicious clear: ${type} removed=${removed} caller=${caller} since_boot_ms=${sinceBootMs} (proxy restarted within ${_RESTART_SUSPICION_WINDOW_MS}ms -- possible historical-event re-fire; verify with tmp/hme-middleware-processed.jsonl)\n`
      );
    } catch (_e) { /* never fail */ }
  }
}

function nexusMark(type, payload) {
  nexusClearType(type);
  nexusAdd(type, payload);
}

function nexusCount(type) {
  try {
    if (!fs.existsSync(NEXUS_FILE)) return 0;
    const lines = fs.readFileSync(NEXUS_FILE, 'utf8').split('\n');
    return lines.filter((l) => l.startsWith(`${type}:`)).length;
  } catch (_e) {
    // silent-ok: optional fallback path.
    return 0;
  }
}

function nexusHas(type, payload) {
  try {
    if (!fs.existsSync(NEXUS_FILE)) return false;
    const lines = fs.readFileSync(NEXUS_FILE, 'utf8').split('\n');
    if (payload) {
      // Parse `${type}:${ts}:${payload}` explicitly -- the previous
      // `endsWith(:payload)` heuristic could match unrelated lines whose
      // timestamp suffix coincidentally ended with the literal needle,
      // and broke entirely on payloads that themselves contain a colon.
      const needle = `${type}:`;
      return lines.some((l) => {
        if (!l.startsWith(needle)) return false;
        const rest = l.slice(needle.length); // ts:payload
        const colonIdx = rest.indexOf(':');
        if (colonIdx < 0) return false;
        return rest.slice(colonIdx + 1) === payload;
      });
    }
    return lines.some((l) => l.startsWith(`${type}:`));
  } catch (_e) {
    // silent-ok: optional fallback path.
    return false;
  }
}

// Per-pipeline-run dirty flag -- set via ctx.markDirty() when a middleware
// mutates the payload. hme_proxy.js uses this to decide whether to
// re-serialize the body before forwarding upstream.
let _pipelineDirty = false;

// Footer-idempotency guard: each middleware passes its own marker so
// multiple can enrich without restacking on proxy restart.

// Retry-count map: bounded per tool_use.id so stuck tasks don't loop forever.
const _retryCount = new Map(); // tool_use.id -> attempts
const _MAX_RETRIES = 3;

function _toolResultText(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
}

const ctx = {
  emit,
  nexusAdd,
  nexusClearType,
  nexusMark,
  nexusCount,
  nexusHas,
  markDirty: () => { _pipelineDirty = true; },
  warn: (...a) => {
    emit({ event: 'middleware_warning', message: a.map(String).join(' ') });
  },
  PROJECT_ROOT,
  // Returns true when the tool_result already contains `marker`. Each
  // middleware passes its unique marker (e.g. '[HME dir:', '[HME] KB',
  // '[HME] bias'). This prevents restart-stacking without blocking other
  // middleware from enriching in the same request.
  hasHmeFooter: (toolResult, marker) => {
    if (!marker) return false;
    return _toolResultText(toolResult).includes(marker);
  },
  // Append text to a tool_result regardless of whether content is a string,
  // array-of-blocks, or null. Shared by all middleware -- do not copy locally.
  appendToResult: (toolResult, text) => {
    if (typeof toolResult.content === 'string') {
      toolResult.content = toolResult.content + text;
      return;
    }
    if (Array.isArray(toolResult.content)) {
      for (const block of toolResult.content) {
        if (block && block.type === 'text') { block.text = (block.text || '') + text; return; }
      }
      toolResult.content.push({ type: 'text', text });
      return;
    }
    toolResult.content = text;
  },
  // Replace tool_result content entirely (for authoritative-real-output
  // cases). Preserves outer shape (string-vs-array) for downstream consumers.
  replaceResult: (toolResult, text) => {
    if (Array.isArray(toolResult.content)) {
      toolResult.content = [{ type: 'text', text }];
    } else {
      toolResult.content = text;
    }
  },
  // Allow tool_use.id re-entry on future turns; bounded by _MAX_RETRIES.
  retryNextTurn: (toolUseId) => {
    if (!toolUseId) return 0;
    const n = (_retryCount.get(toolUseId) || 0) + 1;
    _retryCount.set(toolUseId, n);
    if (n < _MAX_RETRIES) {
      _processed.delete(toolUseId);
    }
    return n;
  },
  // How many times this tool_use.id has requested a retry. 0 = first
  // time middleware has seen it.
  retryAttempt: (toolUseId) => _retryCount.get(toolUseId) || 0,
  // Whether further retries are still allowed.
  retriesRemaining: (toolUseId) => {
    const n = _retryCount.get(toolUseId) || 0;
    return Math.max(0, _MAX_RETRIES - n);
  },
};

//  Registration
const _modules = [];
const _moduleMeta = new Map(); // module.name -> {file, phase}

let _phaseRegistry = null;
function _loadPhaseRegistry() {
  if (_phaseRegistry) return _phaseRegistry;
  try {
    const data = JSON.parse(fs.readFileSync(PHASES_FILE, 'utf8'));
    _phaseRegistry = Array.isArray(data.phases) ? data.phases : [];
  } catch (err) {
    console.warn(`Acceptable warning: [middleware] phase registry unavailable: ${err.message}`);
    _phaseRegistry = [];
  }
  return _phaseRegistry;
}

function _orderPrefix(fname) {
  const m = /^(\d+)_/.exec(fname || '');
  return m ? parseInt(m[1], 10) : null;
}

function _phaseForFile(fname) {
  const n = _orderPrefix(fname);
  if (n === null) return 'unphased';
  const hit = _loadPhaseRegistry().find((phase) => {
    const r = phase && phase.range;
    return Array.isArray(r) && r.length === 2 && n >= Number(r[0]) && n <= Number(r[1]);
  });
  return hit ? hit.id : 'unphased';
}

// Runnable-style shape validator (lesson: langchain_core Runnable).
// Catches the silent-disable bug class: typo'd handler name / missing export.
function _validateMiddlewareShape(mod) {
  if (!mod || typeof mod !== 'object') throw new Error('middleware export must be an object {name, onRequest?, onToolResult?}');
  if (typeof mod.name !== 'string' || !mod.name) throw new Error(`middleware export requires non-empty .name (got ${typeof mod.name})`);
  const hasReq = typeof mod.onRequest === 'function';
  const hasTR = typeof mod.onToolResult === 'function';
  if (!hasReq && !hasTR) throw new Error(`middleware "${mod.name}" exports neither onRequest nor onToolResult -- nothing to do`);
  const ALLOWED = new Set(['name', 'onRequest', 'onToolResult']);
  const unknown = Object.keys(mod).filter((k) => !ALLOWED.has(k));
  if (unknown.length > 0) console.warn(`Acceptable warning: [middleware] "${mod.name}" exports unknown keys ${JSON.stringify(unknown)} -- silently ignored. Mixed-concern smell; extract utilities to a sibling file (proxy/_*.js).`);
}

function register(mod, file = '') {
  _validateMiddlewareShape(mod);
  _modules.push(mod);
  _moduleMeta.set(mod.name, { file, phase: _phaseForFile(file) });
}

function listMiddleware() {
  return _modules.map((mod) => ({
    name: mod.name,
    ...(_moduleMeta.get(mod.name) || { file: '', phase: 'unphased' }),
  }));
}

// Tool-result dedup: each tool_use.id fires onToolResult exactly once
// across conversation lifetime. Map persists to tmp/hme-middleware-processed.jsonl
// so proxy restart doesn't re-fire on historical events (LRU-capped in memory).
const _processed = new Map(); // id -> insertion timestamp
const _PROCESSED_CAP = 50_000;
const _PROCESSED_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-middleware-processed.jsonl');
let _processedLoaded = false;

function _loadProcessed() {
  if (_processedLoaded) return;
  _processedLoaded = true;
  try {
    if (!fs.existsSync(_PROCESSED_FILE)) return;
    const lines = fs.readFileSync(_PROCESSED_FILE, 'utf8').split('\n');
    // Each line is a JSON {id, ts}. Latest-wins for repeated ids (LRU touch).
    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry && entry.id) {
          if (_processed.has(entry.id)) _processed.delete(entry.id);
          _processed.set(entry.id, entry.ts || Date.now());
        }
      } catch (_e) { /* skip malformed line */ }
    }
    // Cap to LRU-most-recent _PROCESSED_CAP -- keys() iterates insertion order.
    if (_processed.size > _PROCESSED_CAP) {
      const excess = _processed.size - _PROCESSED_CAP;
      let i = 0;
      for (const k of _processed.keys()) {
        if (i++ >= excess) break;
        _processed.delete(k);
      }
    }
  } catch (err) {
    console.error(`[middleware] failed to load _processed from disk: ${err.message}`);
  }
}

function _persistProcessedEntry(id, ts) {
  try {
    fs.mkdirSync(path.dirname(_PROCESSED_FILE), { recursive: true });
    fs.appendFileSync(_PROCESSED_FILE, JSON.stringify({ id, ts }) + '\n');
  } catch (_e) { /* best-effort -- never block hot path */ }
}

function _markProcessed(id) {
  _loadProcessed();
  // LRU touch: delete + re-insert moves the key to the end.
  if (_processed.has(id)) {
    _processed.delete(id);
  }
  const now = Date.now();
  _processed.set(id, now);
  _persistProcessedEntry(id, now);
  if (_processed.size > _PROCESSED_CAP) {
    const oldest = _processed.keys().next().value;
    _processed.delete(oldest);
  }
  _maybeCompact();
}

// Periodic compaction -- file is append-only so it grows even when the
// in-memory cap evicts. Compact when file > 8MB by rewriting from the
// current in-memory state. Called opportunistically from _markProcessed
// to avoid a startup blocker.
let _lastCompactCheck = 0;
function _maybeCompact() {
  const now = Date.now();
  if (now - _lastCompactCheck < 60_000) return; // throttle
  _lastCompactCheck = now;
  try {
    const stat = fs.statSync(_PROCESSED_FILE);
    if (stat.size < 8 * 1024 * 1024) return;
    const tmp = _PROCESSED_FILE + '.compact';
    const lines = [];
    for (const [id, ts] of _processed) {
      lines.push(JSON.stringify({ id, ts }));
    }
    fs.writeFileSync(tmp, lines.join('\n') + (lines.length ? '\n' : ''));
    fs.renameSync(tmp, _PROCESSED_FILE);
  } catch (_e) { /* best-effort */ }
}

function _pairToolResults(payload) {
  // Load persisted dedup so a proxy restart doesn't re-fire onToolResult
  // on every historical tool_result. Idempotent; first call only.
  _loadProcessed();
  const msgs = (payload && payload.messages) || [];
  const toolUseById = new Map();
  const events = []; // {toolUse, toolResult}
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b && b.type === 'tool_use' && b.id) toolUseById.set(b.id, b);
      }
    } else if (m.role === 'user') {
      for (const b of m.content) {
        if (b && b.type === 'tool_result' && b.tool_use_id) {
          const tu = toolUseById.get(b.tool_use_id);
          if (tu && !_processed.has(b.tool_use_id)) {
            _markProcessed(b.tool_use_id);
            events.push({ toolUse: tu, toolResult: b });
          } else if (tu) {
            // Touch so a tool_id we see repeatedly stays in the recent set
            _processed.set(b.tool_use_id, Date.now());
          }
        }
      }
    }
  }
  return events;
}

// Single-event entry: apply middleware pipeline to one tool-result without
// the request-shaped runPipeline path. Same architectural shape as stop_chain/cli.
// Usage: middleware.runOnToolResult(toolUse, toolResult, { filter: Set<name> }).
// Skips _processed dedup (single-event callers want determinism).
async function runOnToolResult(toolUse, toolResult, opts = {}) {
  _pipelineDirty = false;
  const filter = opts.filter || null;
  const session = opts.session || null;
  for (const mod of _modules) {
    if (typeof mod.onToolResult !== 'function') continue;
    if (filter && !filter.has(mod.name)) continue;
    try {
      await mod.onToolResult({ toolUse, toolResult, session, ctx });
    } catch (err) {
      console.error(`[middleware] ${mod.name}.onToolResult threw: ${err.message}`);
    }
  }
  return _pipelineDirty;
}

//  Main pipeline entry
// Async so middleware can do HTTP calls (e.g., KB lookups) in their handlers.
// Synchronous handlers still work -- `await` on a non-promise is a no-op.
async function runPipeline(payload, scan, session) {
  _pipelineDirty = false;
  const events = _pairToolResults(payload);
  for (const { toolUse, toolResult } of events) {
    for (const mod of _modules) {
      if (typeof mod.onToolResult !== 'function') continue;
      try {
        await mod.onToolResult({ toolUse, toolResult, session, ctx });
      } catch (err) {
        console.error(`[middleware] ${mod.name}.onToolResult threw: ${err.message}`);
      }
    }
  }
  for (const mod of _modules) {
    if (typeof mod.onRequest !== 'function') continue;
    try {
      await mod.onRequest({ payload, scan, session, ctx });
    } catch (err) {
      console.error(`[middleware] ${mod.name}.onRequest threw: ${err.message}`);
    }
  }
  return _pipelineDirty;
}

// Auto-load modules. Filesystem-encoded ordering: files are named NN_name.js
// where NN is the load-order prefix (replaces the order.json manifest, which
// was a 2-place sync risk). Files without a numeric prefix sort AFTER the
// numbered ones, alphabetically, so new middleware can't be silently disabled.
// A suffix letter (e.g. 08a_) is an explicit substep inside the integer phase.
// rationale: manifest declares intent (phase, name) so renames trip a validator.
function validateManifest(allFiles) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')); }
  catch (_e) { return; }
  const manifestFiles = new Set((manifest.modules || []).map((m) => m.file));
  const onDisk = new Set(allFiles);
  const missingFromManifest = [...onDisk].filter((f) => !manifestFiles.has(f));
  const missingFromDisk = [...manifestFiles].filter((f) => !onDisk.has(f));
  if (missingFromManifest.length || missingFromDisk.length) {
    const msg = `[middleware] manifest drift:\n  on-disk-but-not-in-manifest: ${missingFromManifest.join(', ') || '(none)'}\n  in-manifest-but-not-on-disk: ${missingFromDisk.join(', ') || '(none)'}\n  edit tools/HME/proxy/middleware/manifest.json to reconcile.`;
    if (process.env.HME_PROXY_MIDDLEWARE_MANIFEST_STRICT === '1') throw new Error(msg);
    console.warn(msg);
  }
}

function loadAll() {
  const dir = __dirname;
  const allFiles = fs.readdirSync(dir).filter(f => (
    f !== 'index.js' && f.endsWith('.js')
    && !f.startsWith('test_') && !f.endsWith('.test.js') && !f.endsWith('_test.js')
    && !f.startsWith('_')
  ));
  validateManifest(allFiles);
  // Sort by numeric prefix/substep when present, else alphabetical (after numbered).
  const ordered = allFiles.slice().sort((a, b) => {
    const ma = /^(\d+)([a-z]?)_/.exec(a); const mb = /^(\d+)([a-z]?)_/.exec(b);
    if (ma && mb) {
      const delta = parseInt(ma[1], 10) - parseInt(mb[1], 10);
      return delta || ma[2].localeCompare(mb[2]) || a.localeCompare(b);
    }
    if (ma && !mb) return -1;
    if (!ma && mb) return 1;
    return a.localeCompare(b);
  });
  const unprefixed = ordered.filter(f => !/^\d+[a-z]?_/.test(f));
  if (unprefixed.length > 0) {
    console.warn(`Acceptable warning: [middleware] ${unprefixed.length} file(s) without numeric prefix (loaded alphabetically AFTER prefixed): ${unprefixed.join(', ')}`);
  }
  for (const fname of ordered) {
    try {
      const mod = require(path.join(dir, fname));
      register(mod, fname);
    } catch (err) {
      console.error(`[middleware] failed to load ${fname}: ${err.message}`);
    }
  }
  return _modules.map((m) => m.name);
}

module.exports = { register, runPipeline, runOnToolResult, loadAll, listMiddleware, ctx, _modules, _moduleMeta };
