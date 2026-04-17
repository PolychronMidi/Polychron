'use strict';
/**
 * Grep/Glob semantic-neighborhood enrichment.
 *
 * When a Grep or Glob result concentrates hits in an unexplored directory
 * (≥3 hits, no prior Read from that dir in the last 20 min), append a
 * compact directory preview to the tool_result: `ls` of the dir plus each
 * file's first docstring/comment line.
 *
 * Purpose: surface parallel subsystems that search alone wouldn't reveal.
 * Canonical failure this exists to prevent: "I grepped for 'provider', got
 * 9 hits in tools/HME/mcp/.../synthesis/, didn't realize that's a whole
 * parallel cascade already — wrote a duplicate module from scratch."
 *
 * Explored-directory tracking uses Read tool_results as the explored signal.
 * Enrichment also marks the dir as explored so repeated greps in the same
 * session don't redundantly re-enrich.
 */

const fs = require('fs');
const path = require('path');
const { enrich } = require('../worker_client');

const MIN_HITS_PER_DIR = 3;
const MAX_TOTAL_ENRICHMENT_BYTES = 800;
const MAX_FILES_SHOWN = 10;
const MAX_DIRS_ENRICHED = 2;
const EXPLORED_TTL_MS = 20 * 60 * 1000;

// Only semantically enrich grep patterns that look like a symbol or
// architectural concept — skip regex-heavy / path-heavy patterns.
const SYMBOL_LIKE_RE = /^[A-Za-z_][A-Za-z0-9_]{2,}$/;
const FIREWALL_CATEGORIES = new Set(['architecture', 'decision', 'bugfix', 'antipattern', 'constitution']);
const FIREWALL_MIN_SCORE = 0.5;

// dirPath (absolute) → timestamp ms
const _explored = new Map();

function _markExplored(absDir) {
  if (!absDir) return;
  _explored.set(absDir, Date.now());
}

function _isExplored(absDir) {
  const t = _explored.get(absDir);
  if (!t) return false;
  if (Date.now() - t > EXPLORED_TTL_MS) {
    _explored.delete(absDir);
    return false;
  }
  return true;
}

function _textOf(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

function _appendToResult(toolResult, appendText) {
  if (typeof toolResult.content === 'string') {
    toolResult.content = toolResult.content + appendText;
    return;
  }
  if (Array.isArray(toolResult.content)) {
    for (const block of toolResult.content) {
      if (block && block.type === 'text') {
        block.text = (block.text || '') + appendText;
        return;
      }
    }
    toolResult.content.push({ type: 'text', text: appendText });
    return;
  }
  toolResult.content = appendText;
}

// Extract file paths from a tool_result text. Handles:
//   - Glob output: one path per line
//   - Grep files_with_matches: one path per line
//   - Grep content mode: "path:lineno:text" or "path-lineno-text"
//   - Grep count mode: "path:N"
function _extractPaths(text) {
  const paths = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Skip obvious non-path lines (headers, blank separators, context markers).
    if (line.startsWith('--') || line.startsWith('==')) continue;
    // Path = leading token up to the first colon (only if the token contains
    // a slash OR looks like a file). This avoids false positives on prose.
    const firstColon = line.indexOf(':');
    const candidate = firstColon > 0 ? line.slice(0, firstColon) : line;
    // Reject candidates that don't look like file paths
    if (!candidate.includes('/') && !/\.[a-zA-Z0-9]+$/.test(candidate)) continue;
    if (candidate.length > 400) continue; // sanity cap
    paths.push(candidate);
  }
  return paths;
}

function _firstDocLine(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(600);
    const n = fs.readSync(fd, buf, 0, 600, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf8', 0, n);
    // Python triple-quoted docstring at top
    const pyDoc = head.match(/^"""([\s\S]*?)(?:"""|$)/m);
    if (pyDoc) return pyDoc[1].trim().split('\n')[0].slice(0, 100);
    // Python single-line comment (first non-shebang comment)
    const pyComment = head.match(/^#(?!!)\s*(.+)$/m);
    if (pyComment) return pyComment[1].trim().slice(0, 100);
    // JS/TS block comment at top
    const jsBlock = head.match(/^\/\*\*?\s*([\s\S]*?)(?:\*\/|$)/m);
    if (jsBlock) {
      const cleaned = jsBlock[1].replace(/^\s*\*\s?/gm, '').trim().split('\n')[0];
      if (cleaned) return cleaned.slice(0, 100);
    }
    // JS/TS line comment at top (skip 'use strict' pragmas)
    for (const line of head.split('\n').slice(0, 6)) {
      const m = line.match(/^\s*\/\/\s*(.+)$/);
      if (m && !/use strict/.test(m[1])) return m[1].trim().slice(0, 100);
    }
    return '';
  } catch (_e) {
    return '';
  }
}

function _buildDirSummary(absDir, budgetBytes) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (_e) {
    return null;
  }
  const files = entries
    .filter((e) => !e.name.startsWith('.') && e.name !== '__pycache__' && e.name !== 'node_modules')
    .sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) return null;
  const lines = [];
  let used = 0;
  let shownCount = 0;
  for (const ent of files) {
    if (shownCount >= MAX_FILES_SHOWN) break;
    let line;
    if (ent.isDirectory()) {
      line = `  ${ent.name}/`;
    } else {
      const doc = _firstDocLine(path.join(absDir, ent.name));
      line = doc ? `  ${ent.name} — ${doc}` : `  ${ent.name}`;
    }
    const nextLen = used + line.length + 1; // + newline
    if (nextLen > budgetBytes) break;
    lines.push(line);
    used = nextLen;
    shownCount++;
  }
  if (lines.length === 0) return null;
  const remaining = files.length - shownCount;
  if (remaining > 0) {
    const tail = `  … (+${remaining} more)`;
    if (used + tail.length + 1 <= budgetBytes) {
      lines.push(tail);
    }
  }
  return lines.join('\n');
}

module.exports = {
  name: 'grep_glob_neighborhood',

  async onToolResult({ toolUse, toolResult, ctx }) {
    const name = toolUse.name || '';

    // Read → track its directory as explored; don't enrich.
    if (name === 'Read') {
      const fp = (toolUse.input && (toolUse.input.file_path || toolUse.input.path)) || '';
      if (fp) {
        const abs = path.isAbsolute(fp) ? fp : path.join(ctx.PROJECT_ROOT, fp);
        _markExplored(path.dirname(abs));
      }
      return;
    }

    if (name !== 'Grep' && name !== 'Glob') return;

    const text = _textOf(toolResult);
    if (!text) return;

    // Semantic firewall — when the grep pattern is a bare symbol, check if KB
    // has a high-signal architecture/bugfix/antipattern entry for it. This
    // catches queries like `couplingMatrix` or `VALIDATED_GLOBALS` before
    // the agent duplicates effort.
    const pattern = (toolUse.input && toolUse.input.pattern) || '';
    const firewallLines = [];
    if (name === 'Grep' && SYMBOL_LIKE_RE.test(pattern)) {
      const result = await enrich(pattern, 3);
      const kb = (result && Array.isArray(result.kb)) ? result.kb : [];
      for (const e of kb) {
        if (firewallLines.length >= 2) break;
        const score = typeof e.score === 'number' ? e.score : 0;
        const cat = String(e.category ? e.category : '');
        if (score < FIREWALL_MIN_SCORE || !FIREWALL_CATEGORIES.has(cat)) continue;
        const title = String(e.title ? e.title : '').slice(0, 120);
        if (title) firewallLines.push(`[${cat}] "${title}" — relevant; learn(query='${pattern}') for detail`);
      }
    }

    const paths = _extractPaths(text);
    if (paths.length < MIN_HITS_PER_DIR && firewallLines.length === 0) return;

    // Count hits per directory (normalized to absolute)
    const dirCounts = new Map();
    for (const p of paths) {
      const abs = path.isAbsolute(p) ? p : path.join(ctx.PROJECT_ROOT, p);
      const dir = path.dirname(abs);
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }

    // Unexplored dirs with ≥ MIN_HITS, sorted by hit count descending.
    const hot = [...dirCounts.entries()]
      .filter(([d, n]) => n >= MIN_HITS_PER_DIR && !_isExplored(d))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DIRS_ENRICHED);
    if (hot.length === 0 && firewallLines.length === 0) return;

    const blocks = [];
    let totalBytes = 0;
    for (const [dir, count] of hot) {
      const perDirBudget = Math.floor((MAX_TOTAL_ENRICHMENT_BYTES - totalBytes) / Math.max(1, hot.length - blocks.length));
      // Reserve ~120 bytes for the header; give the rest to the file summary.
      const summaryBudget = Math.max(100, perDirBudget - 120);
      const summary = _buildDirSummary(dir, summaryBudget);
      if (!summary) continue;
      const relDir = path.relative(ctx.PROJECT_ROOT, dir) || dir;
      const header = `\n\n[HME:neighborhood:${relDir}/ (${count} hits)]\n`;
      const block = header + summary;
      if (totalBytes + block.length > MAX_TOTAL_ENRICHMENT_BYTES) continue;
      blocks.push(block);
      totalBytes += block.length;
      _markExplored(dir);
    }

    if (blocks.length === 0 && firewallLines.length === 0) return;
    if (ctx.hasHmeFooter(toolResult, '[HME:neighborhood')) return;

    let appended = blocks.join('');
    if (firewallLines.length > 0) {
      appended += '\n[HME KB firewall] ' + firewallLines.join(' | ');
    }
    _appendToResult(toolResult, appended);
    ctx.markDirty();
    ctx.emit({
      event: 'neighborhood_enrichment',
      dirs: hot.slice(0, blocks.length).map(([d]) => path.basename(d)).join('|'),
      bytes: totalBytes + (firewallLines.length > 0 ? 32 + firewallLines.join(' | ').length : 0),
      firewall: firewallLines.length,
    });
  },
};
