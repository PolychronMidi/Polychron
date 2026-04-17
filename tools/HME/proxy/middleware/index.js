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
 *   - emit(fields)              — activity event via emit.py
 *   - nexusAdd(type, payload)   — append to tmp/hme-nexus.state
 *   - nexusClearType(type)      — remove all entries of a type
 *   - nexusMark(type, payload)  — replace-one-of-type
 *   - warn(msg)                 — log to stderr with [middleware] prefix
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

const ctx = {
  emit,
  nexusAdd,
  nexusClearType,
  nexusMark,
  nexusCount,
  warn: (...a) => console.warn('[middleware]', ...a),
  PROJECT_ROOT,
};

// ── Registration ─────────────────────────────────────────────────────────────
const _modules = [];

function register(mod) {
  if (!mod || !mod.name) throw new Error('middleware module requires a name');
  _modules.push(mod);
}

// ── Tool-result deduplication ────────────────────────────────────────────────
// Each tool_use.id fires onToolResult exactly once per proxy lifetime.
const _processed = new Set();

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
            _processed.add(b.tool_use_id);
            events.push({ toolUse: tu, toolResult: b });
            // Cap the processed set so it can't grow unbounded across a very
            // long session. 10k entries ≈ 500 KB RSS.
            if (_processed.size > 10_000) {
              const first = _processed.values().next().value;
              _processed.delete(first);
            }
          }
        }
      }
    }
  }
  return events;
}

// ── Main pipeline entry ──────────────────────────────────────────────────────
function runPipeline(payload, scan, session) {
  // Pair tool_use + tool_result events, fire onToolResult for each.
  const events = _pairToolResults(payload);
  for (const { toolUse, toolResult } of events) {
    for (const mod of _modules) {
      if (typeof mod.onToolResult !== 'function') continue;
      try {
        mod.onToolResult({ toolUse, toolResult, session, ctx });
      } catch (err) {
        console.error(`[middleware] ${mod.name}.onToolResult threw: ${err.message}`);
      }
    }
  }
  // Per-request middleware (runs once per Anthropic request).
  for (const mod of _modules) {
    if (typeof mod.onRequest !== 'function') continue;
    try {
      mod.onRequest({ payload, scan, session, ctx });
    } catch (err) {
      console.error(`[middleware] ${mod.name}.onRequest threw: ${err.message}`);
    }
  }
}

// ── Auto-load modules ────────────────────────────────────────────────────────
function loadAll() {
  const dir = __dirname;
  for (const fname of fs.readdirSync(dir)) {
    if (fname === 'index.js' || !fname.endsWith('.js')) continue;
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
