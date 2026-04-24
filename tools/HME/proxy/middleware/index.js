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
 *   - emit(fields)                        — activity event via emit.py
 *   - nexusAdd/Mark/ClearType/Has/Count   — tmp/hme-nexus.state operations
 *   - warn(msg)                           — log to stderr with [middleware] prefix
 *   - markDirty()                         — signal payload needs re-serialize
 *   - hasHmeFooter(result, marker)        — idempotency guard for enrichment
 *   - appendToResult(result, text)        — append text to tool_result (any shape)
 *   - replaceResult(result, text)         — REPLACE tool_result content entirely
 *                                           (use when authoritative real output
 *                                           supersedes a stub, e.g. background
 *                                           task resolution)
 *   - retryNextTurn(toolUseId)            — remove dedup so middleware re-enters
 *                                           on a future turn; bounded by
 *                                           _MAX_RETRIES to avoid infinite loops
 *   - retryAttempt(toolUseId)             — how many retries so far (0 = first)
 *   - retriesRemaining(toolUseId)         — remaining budget before permanent
 *                                           pass-through
 */

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('../shared');

const NEXUS_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-nexus.state');

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

function nexusClearType(type) {
  _ensureDir(NEXUS_FILE);
  try {
    if (!fs.existsSync(NEXUS_FILE)) return;
    const lines = fs.readFileSync(NEXUS_FILE, 'utf8').split('\n');
    const kept = lines.filter((l) => l && !l.startsWith(`${type}:`));
    fs.writeFileSync(NEXUS_FILE, kept.join('\n') + (kept.length ? '\n' : ''));
  } catch (err) {
    console.error(`[middleware] nexusClearType ${type} failed: ${err.message}`);
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
    return 0;
  }
}

function nexusHas(type, payload) {
  try {
    if (!fs.existsSync(NEXUS_FILE)) return false;
    const lines = fs.readFileSync(NEXUS_FILE, 'utf8').split('\n');
    if (payload) {
      const needle = `${type}:`;
      return lines.some((l) => l.startsWith(needle) && l.endsWith(`:${payload}`));
    }
    return lines.some((l) => l.startsWith(`${type}:`));
  } catch (_e) {
    return false;
  }
}

// Per-pipeline-run dirty flag — set via ctx.markDirty() when a middleware
// mutates the payload. hme_proxy.js uses this to decide whether to
// re-serialize the body before forwarding upstream.
let _pipelineDirty = false;

// Idempotency guard for footer injection. Because _processed is in-memory,
// a proxy restart causes all historical tool_results to look "new" and get
// re-enriched. Each middleware passes its OWN marker to the guard — not a
// shared HME prefix — so multiple middleware can enrich the same result
// without blocking each other, while still preventing self-restacking.

// Retry-count map for middleware that need to re-enter on future turns
// (e.g. background_dominance when a task hasn't finished within the
// current turn's wait window). Bounded per tool_use.id so a permanently
// stuck task doesn't retry forever.
const _retryCount = new Map(); // tool_use.id → attempts
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
  warn: (...a) => console.warn('Acceptable warning: [middleware]', ...a),
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
  // array-of-blocks, or null. Shared by all middleware — do not copy locally.
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
  // Replace the tool_result content entirely. For when a middleware has
  // authoritative real output (e.g. background-task resolution) and the
  // native stub should be dropped, not appended-to. Preserves the outer
  // shape (string-vs-array) so downstream consumers see the form they
  // expect.
  replaceResult: (toolResult, text) => {
    if (Array.isArray(toolResult.content)) {
      toolResult.content = [{ type: 'text', text }];
    } else {
      toolResult.content = text;
    }
  },
  // Tell the pipeline to allow this tool_use.id to re-enter on a future
  // turn — used by middleware whose work is unfinished (e.g. background
  // task still running). Bounded by _MAX_RETRIES so a stuck task
  // doesn't retry forever. Returns the attempt count AFTER the call so
  // callers can log or short-circuit.
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

function register(mod) {
  if (!mod || !mod.name) throw new Error('middleware module requires a name');
  _modules.push(mod);
}

//  Tool-result deduplication
// Each tool_use.id fires onToolResult exactly once per proxy lifetime.
// Map preserves insertion order; touch-on-access makes this LRU-ish (entries
// seen recently move to the back and survive eviction longer than stale ones).
const _processed = new Map(); // id → insertion timestamp
const _PROCESSED_CAP = 50_000;

function _markProcessed(id) {
  // LRU touch: delete + re-insert moves the key to the end.
  if (_processed.has(id)) {
    _processed.delete(id);
  }
  _processed.set(id, Date.now());
  if (_processed.size > _PROCESSED_CAP) {
    const oldest = _processed.keys().next().value;
    _processed.delete(oldest);
  }
}

function _pairToolResults(payload) {
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

//  Main pipeline entry
// Async so middleware can do HTTP calls (e.g., KB lookups) in their handlers.
// Synchronous handlers still work — `await` on a non-promise is a no-op.
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

//  Auto-load modules
//
// Load order matters when one middleware enriches a payload that another
// reads (e.g. lifesaver_inject must run BEFORE proxy_autocommit so a
// failed autocommit surfaces as the lifesaver banner on the same turn).
// The previous loader used readdirSync ordering — filesystem inode order,
// undefined across filesystems and OS upgrades. We now consult an
// explicit `order.json` manifest and fall back to alphabetical for any
// file not listed (so a new middleware doesn't get silently disabled).
function loadAll() {
  const dir = __dirname;
  let manifest = [];
  try {
    const manifestPath = path.join(dir, 'order.json');
    if (fs.existsSync(manifestPath)) {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (Array.isArray(raw.order)) manifest = raw.order;
    }
  } catch (err) {
    console.error(`[middleware] order.json read failed (using alphabetical): ${err.message}`);
  }
  const allFiles = fs.readdirSync(dir).filter(f => (
    f !== 'index.js' && f !== 'order.json' && f.endsWith('.js')
    // Exclude test files: `test_*.js`, `*.test.js`, `*_test.js`. Tests live
    // next to the code they exercise (cohesive, easy to find) but are not
    // middleware themselves and must not be register()'d.
    && !f.startsWith('test_') && !f.endsWith('.test.js') && !f.endsWith('_test.js')
  ));
  const inManifest = manifest.filter(name => allFiles.includes(name));
  const unlisted = allFiles.filter(name => !manifest.includes(name)).sort();
  if (unlisted.length > 0 && manifest.length > 0) {
    console.warn(`[middleware] ${unlisted.length} file(s) not in order.json (loaded alphabetically AFTER manifest): ${unlisted.join(', ')}`);
  }
  const ordered = [...inManifest, ...unlisted];
  for (const fname of ordered) {
    try {
      const mod = require(path.join(dir, fname));
      register(mod);
    } catch (err) {
      console.error(`[middleware] failed to load ${fname}: ${err.message}`);
    }
  }
  return _modules.map((m) => m.name);
}

module.exports = { register, runPipeline, loadAll, ctx, _modules };
