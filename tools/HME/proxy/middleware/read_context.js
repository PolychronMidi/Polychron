'use strict';
/**
 * Read context — appends ACTIONABLE intel to Read tool_results:
 *
 *   1. Open hypothesis for this module → claim text + falsifier, so the agent
 *      knows what invariant an edit must preserve (or explicitly falsify).
 *   2. Callers of this module → list of files that import it, so the agent
 *      knows the blast radius before changing any signature.
 *   3. KB semantic drift → warn that the stored KB description for this
 *      module is stale, so the agent doesn't cargo-cult from memory and
 *      instead verifies from the code they just read.
 *
 * Silent when none of these apply — most reads get no footer.
 * Callers are cached per-session to amortize the rg subprocess cost.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const { openHypothesesFor, driftFor } = require('../context');
const { enrich } = require('../worker_client');

// Semantic hint only surfaces when static coverage is empty AND the top
// RAG hit is above this threshold. Below this = weak match, probably noise.
const SEMANTIC_HINT_MIN_SCORE = 0.55;
const SEMANTIC_HINT_CATEGORIES = new Set(['architecture', 'decision', 'pattern', 'constitution']);

const MAX_CALLERS_SHOWN = 4;
const CALLER_SCAN_DIRS = ['src', 'tools/HME'];
const _callerCache = new Map(); // file path → caller list (per-process)

function _stemOf(fp) {
  return path.basename(fp, path.extname(fp));
}

// Files that export API — worth computing callers for. Skip tests, configs, docs.
function _isExportableModule(fp) {
  if (!fp) return false;
  const rel = fp.includes('/Polychron/') ? fp.slice(fp.indexOf('/Polychron/') + 11) : fp;
  if (!CALLER_SCAN_DIRS.some((d) => rel.startsWith(d + '/'))) return false;
  if (/\.(test|spec)\./.test(rel)) return false;
  if (rel.endsWith('.md') || rel.endsWith('.json') || rel.endsWith('.sh')) return false;
  return true;
}

function _findCallers(projectRoot, filePath) {
  if (_callerCache.has(filePath)) return _callerCache.get(filePath);
  const stem = _stemOf(filePath);
  if (!stem || stem.length < 3) {
    _callerCache.set(filePath, []);
    return [];
  }
  // Match relative requires/imports ending in this basename. POSIX ERE for
  // plain grep — (require|from), optional whitespace + paren, a quote, any
  // non-quote chars, /stem, closing quote, optional paren.
  // Escape ERE meta in the stem before interpolation. Filenames with `.`,
  // `|`, `+`, `[`, `]`, `(`, `)`, `*`, `?`, `^`, `$`, `\` would otherwise
  // produce a malformed or over-broad regex (a stem like `a|b` matched
  // every file containing `a` or `b`, swelling the caller list).
  const _ereEscape = (s) => String(s).replace(/[.\\+*?[\]^$(){}|]/g, '\\$&');
  const pattern = `(require|from)[[:space:]]*[(]?['"][^'"]*[/]${_ereEscape(stem)}['"][)]?`;
  const args = ['-rl', '-E', pattern, '--include=*.js', '--include=*.ts', '--include=*.tsx', '--include=*.mjs', '--include=*.cjs', '--', ...CALLER_SCAN_DIRS];
  let out = '';
  try {
    out = execFileSync('grep', args, { cwd: projectRoot, encoding: 'utf8', timeout: 3000, maxBuffer: 128 * 1024 });
  } catch (_e) {
    // grep exits 1 on no matches; any error → treat as no callers (silent)
    _callerCache.set(filePath, []);
    return [];
  }
  const selfRel = filePath.startsWith(projectRoot + '/') ? filePath.slice(projectRoot.length + 1) : filePath;
  const callers = out.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== selfRel);
  _callerCache.set(filePath, callers);
  return callers;
}

module.exports = {
  name: 'read_context',

  async onToolResult({ toolUse, toolResult, ctx }) {
    if (toolUse.name !== 'Read') return;
    const fp = (toolUse.input && toolUse.input.file_path) || '';
    if (!fp) return;
    const stem = _stemOf(fp);
    const lines = [];

    const hyps = openHypothesesFor(stem);
    for (const h of hyps.slice(0, 1)) {
      const claim = String(h.claim || '').slice(0, 120).trim();
      const falsifier = String(h.falsification || '').slice(0, 100).trim();
      if (!claim) continue;
      lines.push(`hyp ${h.id}: ${claim}`);
      if (falsifier) lines.push(`  falsify: ${falsifier}`);
    }

    const drift = driftFor(stem);
    if (drift) {
      const diffs = Array.isArray(drift.diffs) ? drift.diffs : [];
      const fields = diffs.filter((d) => d.field !== 'content_hash_prefix').map((d) => d.field).slice(0, 3).join(', ');
      lines.push(`KB stale (${fields || 'structural'}) — trust code, not cache`);
    }

    if (_isExportableModule(fp)) {
      const callers = _findCallers(ctx.PROJECT_ROOT, fp);
      if (callers.length > 0) {
        const shown = callers.slice(0, MAX_CALLERS_SHOWN).map((c) => path.basename(c)).join(', ');
        const tail = callers.length > MAX_CALLERS_SHOWN ? ` +${callers.length - MAX_CALLERS_SHOWN}` : '';
        lines.push(`callers: ${shown}${tail}`);
      }
    }

    if (lines.length === 0 && _isExportableModule(fp)) {
      const result = await enrich(stem, 3);
      const top = (result && Array.isArray(result.kb)) ? result.kb[0] : null;
      if (top && typeof top.score === 'number' && top.score >= SEMANTIC_HINT_MIN_SCORE
          && SEMANTIC_HINT_CATEGORIES.has(top.category)) {
        const title = String(top.title || '').slice(0, 100);
        if (title) lines.push(`KB:${top.category} "${title}" — learn(query='${stem}')`);
      }
    }

    if (lines.length === 0) return;
    if (ctx.hasHmeFooter(toolResult, '[HME:read]')) return;
    const footer = '\n[HME:read] ' + lines.join(' | ');
    ctx.appendToResult(toolResult, footer);
    ctx.markDirty();
    ctx.emit({ event: 'read_context', file: fp, lines: lines.length });
  },
};
