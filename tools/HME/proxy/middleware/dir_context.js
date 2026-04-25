'use strict';
/**
 * Directory-intent enrichment — reads metrics/hme-dir-intent.json and injects
 * the closest ancestor directory's local rules when a tool touches a file.
 *
 * Fires on Read/Edit/Write/Grep/Glob. Walks up from the target path to the
 * nearest tracked directory; appends one line with up to 2 rules. Silent when
 * no tracked ancestor, when rules list is empty, or when the tool_result
 * already has an HME footer (idempotency guard).
 *
 * Info / children are NEVER auto-injected — they're surfaced only when the
 * agent reads the README explicitly. Rules are the high-value, low-drift slice.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, mtimeCache } = require('../shared');
const METRICS_DIR = process.env.METRICS_DIR || path.join(PROJECT_ROOT, 'output', 'metrics');

const INTENT_PATH = path.join(METRICS_DIR, 'hme-dir-intent.json');
const REFRESH_MS = 60_000;
const MAX_RULES_INJECTED = 2;
const MAX_FOOTER_CHARS = 180;

// Use the shared mtime-checked cache primitive (replaces the per-file
// clock-only TTL caches that served stale data after aggregator rewrites).
const _intentCache = mtimeCache({ ttlMs: REFRESH_MS });
let _index = {};
let _indexEmpty = true;
let _trackedPaths = []; // sorted by depth desc so longest match wins
let _trackedPathsBuiltFrom = null; // index identity that produced _trackedPaths

function _loadIndex(_projectRoot) {
  const indexPair = _intentCache.get(INTENT_PATH, () => {
    if (!fs.existsSync(INTENT_PATH)) return { index: {}, empty: true };
    try {
      const raw = fs.readFileSync(INTENT_PATH, 'utf8');
      const data = JSON.parse(raw);
      const dirs = (data && typeof data.dirs === 'object') ? data.dirs : {};
      const index = {};
      for (const [k, v] of Object.entries(dirs)) {
        index[k] = { rules: v.rules, drifted: v.drifted };
      }
      return { index, empty: Object.keys(index).length === 0 };
    } catch (_e) {
      return { index: {}, empty: true };
    }
  });
  // Sync module-level state with the cached pair only when the cached
  // identity changed (avoids re-sorting on every cache hit).
  if (_trackedPathsBuiltFrom !== indexPair) {
    _index = indexPair.index;
    _indexEmpty = indexPair.empty;
    _trackedPaths = Object.keys(_index).sort((a, b) => b.length - a.length);
    _trackedPathsBuiltFrom = indexPair;
  }
  return _index;
}


function _relToProject(fp, projectRoot) {
  if (!fp) return '';
  if (fp.startsWith(projectRoot + '/')) return fp.slice(projectRoot.length + 1);
  return fp;
}

function _closestTrackedDir(rel) {
  for (const tracked of _trackedPaths) {
    if (rel === tracked || rel.startsWith(tracked + '/')) return tracked;
  }
  return null;
}

function _extractTargetPath(toolUse) {
  const input = toolUse.input || {};
  // Glob: pattern may resolve to multiple; use pattern dir
  if (toolUse.name === 'Glob') {
    const pattern = input.pattern || '';
    const searchPath = input.path || '';
    if (searchPath) return searchPath;
    // strip glob wildcards from pattern to get dir
    const cleaned = pattern.replace(/\*\*?.*$/, '').replace(/\/[^\/]*\*.*$/, '');
    return cleaned;
  }
  // Grep: path param when given, else skip (too broad)
  if (toolUse.name === 'Grep') return input.path || '';
  // Read/Edit/Write/NotebookEdit
  return input.file_path || input.path || '';
}

const ENRICHED_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Grep', 'Glob']);

module.exports = {
  name: 'dir_context',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (!ENRICHED_TOOLS.has(toolUse.name || '')) return;
    const target = _extractTargetPath(toolUse);
    if (!target) return;
    _loadIndex(ctx.PROJECT_ROOT);
    if (_indexEmpty) return;

    const rel = _relToProject(target, ctx.PROJECT_ROOT);
    const tracked = _closestTrackedDir(rel);
    if (!tracked) return;

    const entry = _index[tracked];
    if (!entry || !Array.isArray(entry.rules) || entry.rules.length === 0) return;
    if (ctx.hasHmeFooter(toolResult, '[HME dir:')) return;

    // Pick the first N rules, cap total char budget.
    const parts = [];
    let used = 0;
    for (const r of entry.rules.slice(0, MAX_RULES_INJECTED)) {
      const s = String(r).trim();
      if (!s) continue;
      if (used + s.length + 3 > MAX_FOOTER_CHARS) break;
      parts.push(s);
      used += s.length + 3;
    }
    if (parts.length === 0) return;

    const dirName = path.basename(tracked);
    const driftTag = entry.drifted ? ' (drifted)' : '';
    const footer = `\n[HME dir:${dirName}${driftTag}] ${parts.join(' | ')}`;
    ctx.appendToResult(toolResult, footer);
    ctx.markDirty();
    ctx.emit({
      event: 'dir_context',
      dir: dirName,
      rules_injected: parts.length,
      drifted: !!entry.drifted,
    });
  },
};
