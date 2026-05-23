'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

// Time-ordered file patterns. When Read is called against one of these with
// a `limit` but no `offset`, the policy auto-tails by mutating offset so the
const TIME_ORDERED_EXT = new Set(['.jsonl', '.ndjson', '.log', '.out']);
const TIME_ORDERED_PREFIX = ['log/', 'tmp/', 'tools/HME/runtime/'];
function isTimeOrdered(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (TIME_ORDERED_EXT.has(ext)) return true;
  if (TIME_ORDERED_PREFIX.some((p) => rel.startsWith(p))) return true;
  return false;
}
function _lineCount(file) {
  try {
    const buf = fs.readFileSync(file);
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
    return buf.length > 0 && buf[buf.length - 1] !== 0x0a ? n + 1 : n;
  } catch (_e) { return 0; /* silent-ok: missing/unreadable -> no rewrite */ }
}
function autoTailRewrite(input, file) {
  const limit = Number(input.limit || 0);
  const offset = Number(input.offset || 0);
  if (!limit || offset) return null;
  const lines = _lineCount(file);
  if (lines <= limit) return null;
  return { ...input, offset: lines - limit };
}

function _permission(decision, reason = '') { return { decision, reason }; }
function relPath(file, root = PROJECT_ROOT) {
  const f = String(file || '');
  return root && f.startsWith(root + '/') ? f.slice(root.length + 1) : f.replace(/^\.\//, '');
}
function loadConfig(root = PROJECT_ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'tools/HME/config/context-guards.json'), 'utf8')); }
  catch (_e) { return null; /* silent-ok: absent config means no read policy. */ }
}
function editedThisTurn(file, root = PROJECT_ROOT) {
  const base = path.basename(String(file || '')).replace(/\.[^.]*$/, '');
  if (!base) return false;
  try {
    const entries = fs.readFileSync(path.join(root, 'tmp/hme-turn-edits.txt'), 'utf8').split(/\r?\n/);
    return entries.some((line) => line === base || line.startsWith(`${base}:`));
  } catch (_e) { return false; /* silent-ok: no turn edit state yet. */ }
}

// Return the set of edited line ranges (1-based inclusive [start, end]) for
// the given file's basename. `[0,0]` is a sentinel meaning "whole file /
function editedRangesThisTurn(file, root = PROJECT_ROOT) {
  const base = path.basename(String(file || '')).replace(/\.[^.]*$/, '');
  if (!base) return [];
  try {
    const out = [];
    const entries = fs.readFileSync(path.join(root, 'tmp/hme-turn-edits.txt'), 'utf8').split(/\r?\n/);
    for (const line of entries) {
      if (line === base) { out.push([0, 0]); continue; }
      if (!line.startsWith(`${base}:`)) continue;
      const m = line.slice(base.length + 1).match(/^(\d+)-(\d+)$/);
      if (!m) { out.push([0, 0]); continue; }
      out.push([Number(m[1]), Number(m[2])]);
    }
    return out;
  } catch (_e) { return []; /* silent-ok: no turn edit state yet. */ }
}

function _readWindowOverlapsEdits(input, ranges) {
  // Whole-file edit / non-locatable -> always overlaps.
  if (ranges.some(([s, e]) => s === 0 && e === 0)) return true;
  const limit = Number(input.limit || 0);
  const offset = Number(input.offset || 0);
  // Unbounded read covers the whole file -> overlaps any edit.
  if (!limit && !offset) return true;
  // 1-based inclusive [readStart, readEnd]. Read tool offset is 1-based start.
  const readStart = offset > 0 ? offset : 1;
  const readEnd = limit > 0 ? readStart + limit - 1 : Number.MAX_SAFE_INTEGER;
  return ranges.some(([s, e]) => s <= readEnd && e >= readStart);
}

function evaluateReadInput(input = {}, opts = {}) {
  const root = opts.projectRoot || PROJECT_ROOT;
  const file = input.file_path || input.path || '';
  if (!file) return { decision: 'allow' };
  const rel = relPath(file, root);
  // verify-landed antipattern: fires only when the Read window actually
  // overlaps an edited line range. Reads of different regions, or reads of
  // unedited files, proceed normally.
  if (opts.verifyLanded !== false) {
    const ranges = editedRangesThisTurn(file, root);
    if (ranges.length > 0 && _readWindowOverlapsEdits(input, ranges)) {
      const base = path.basename(file).replace(/\.[^.]*$/, '');
      const rng = ranges.map(([s, e]) => (s === 0 && e === 0 ? 'whole-file' : `${s}-${e}`)).join(',');
      return { decision: 'deny', reason: `BLOCKED: verify-landed antipattern -- Read of ${base} overlaps edited range(s) [${rng}] from this turn. The Edit tool already returned [SUCCESS]; re-reading the just-edited region is context-burn. Read a non-overlapping window via offset+limit if you need a different part.` };
    }
  }
  if (/\.claude\/projects\/.*\/(memory\/|MEMORY\.md)/.test(file)) {
    return { decision: 'deny', reason: 'BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn query="<what you need>".' };
  }
  const cfg = loadConfig(root);
  if (cfg) {
    for (const p of cfg.blocked_paths || []) {
      if ((p.endsWith('/') && rel.startsWith(p)) || rel === p) return { decision: 'deny', reason: `BLOCKED: ${rel} matches guarded path '${p}'. Use Grep with a targeted pattern, or read a smaller canonical file.` };
    }
    for (const ext of cfg.blocked_extensions || []) if (rel.endsWith(ext)) return { decision: 'deny', reason: `BLOCKED: ${rel} matches guarded extension '*${ext}'.` };
    for (const e of cfg.paginated_paths || []) {
      const prefix = e.prefix || '';
      if (!prefix || !rel.startsWith(prefix)) continue;
      const max = Number(e.max_lines || 200);
      const limit = Number(input.limit || 0);
      if (!limit || limit > max) return { decision: 'deny', reason: `BLOCKED: ${rel} is paginated-only (${e.reason || 'large file'}). Pass explicit limit<=${max} and usually offset.` };
    }
  }
  if (isTimeOrdered(rel)) {
    const rewritten = autoTailRewrite(input, file);
    if (rewritten) {
      return { decision: 'allow', input: rewritten, changed: true };
    }
  }
  if (cfg) {
    try {
      const soft = Number(cfg.soft_size_limit_bytes || 150000);
      const st = fs.statSync(file);
      if (st.size > soft && !input.limit && !input.offset) return { decision: 'allow', reason: `NEXUS: ${rel} is ${Math.floor(st.size / 1024)}KB -- consider limit/offset if you only need part of it.` };
    } catch (_e) { /* silent-ok: missing/unstatable file falls through to host error. */ }
  }
  return { decision: 'allow' };
}

function toHookResponse(result, event = 'PreToolUse') {
  if (!result || (result.decision === 'allow' && !result.reason && !result.changed)) return '';
  if (result.decision === 'deny') return JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: result.reason }, systemMessage: result.reason });
  const hso = { hookEventName: event, permissionDecision: 'allow' };
  if (result.changed) hso.updatedInput = result.input;
  if (result.reason) hso.additionalContext = result.reason;
  return JSON.stringify({ hookSpecificOutput: hso, systemMessage: result.reason || '' });
}

module.exports = { evaluateReadInput, toHookResponse };
