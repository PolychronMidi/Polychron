'use strict';
/**
 * Bash envelopment — appends a compact annotation to Bash tool_results when
 * there's real signal worth surfacing:
 *
 *   1. Error patterns in output (Traceback, ERROR, FAIL, Segfault, OOM) —
 *      one-line context snippet.
 *   2. Destructive command detected (rm -rf, git reset --hard, git push
 *      --force, dropdb, DROP TABLE) — flag what ran.
 *   3. File writes via >, >>, sed -i, cp, mv, tee into indexed files —
 *      compact KB coverage note for affected paths (same shape as
 *      edit_enrichment, since the agent is effectively editing via shell).
 *
 * Clean runs pass through with no footer — no false "HME" chatter on trivial
 * commands. Footer capped at 400 bytes.
 */

const path = require('path');
const { isFileIndexed, buildFileEnrichment } = require('../context');

const MAX_FOOTER_BYTES = 400;

const DESTRUCTIVE_RE = /\b(rm\s+-rf|git\s+reset\s+--hard|git\s+push\s+(?:--force|-f)\b|dropdb|DROP\s+TABLE)/i;
const ERROR_RE = /(\bTraceback\b|\bERROR\b|\bFAIL(?:ED)?\b|Segmentation fault|core dumped|OutOfMemory|OOMKilled)/;

// Shell constructs that redirect/write to a path. Each regex captures ONE target path.
const WRITE_TARGET_RES = [
  /(?:^|[\s;&|])>\s*(\S+)/g,
  />>\s*(\S+)/g,
  /\bsed\s+-i(?:\s+['"][^'"]*['"])?\s+(\S+)/g,
  /\btee\s+(?:-a\s+)?(\S+)/g,
  /\bcp\s+\S+\s+(\S+)/g,
  /\bmv\s+\S+\s+(\S+)/g,
];

function _extractWrittenPaths(cmd) {
  const paths = new Set();
  for (const re of WRITE_TARGET_RES) {
    for (const m of cmd.matchAll(re)) {
      const p = (m[1] || '').replace(/^['"]|['"]$/g, '');
      if (!p || p.startsWith('-') || p.startsWith('/dev/') || p === '/dev/null') continue;
      paths.add(p);
    }
  }
  return [...paths];
}

function _textOf(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

function _appendToResult(toolResult, text) {
  if (typeof toolResult.content === 'string') {
    toolResult.content = toolResult.content + text;
    return;
  }
  if (Array.isArray(toolResult.content)) {
    for (const block of toolResult.content) {
      if (block && block.type === 'text') {
        block.text = (block.text || '') + text;
        return;
      }
    }
    toolResult.content.push({ type: 'text', text });
    return;
  }
  toolResult.content = text;
}

function _firstErrorSnippet(text) {
  for (const line of text.split('\n')) {
    if (ERROR_RE.test(line)) return line.trim().slice(0, 120);
  }
  return '';
}

module.exports = {
  name: 'bash_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (toolUse.name !== 'Bash') return;
    const cmd = (toolUse.input && toolUse.input.command) || '';
    if (!cmd) return;

    const parts = [];

    const text = _textOf(toolResult);
    if (text && ERROR_RE.test(text)) {
      const snip = _firstErrorSnippet(text);
      parts.push(snip ? `⚠err:${snip}` : '⚠err');
    }

    const dMatch = cmd.match(DESTRUCTIVE_RE);
    if (dMatch) parts.push(`⚠destructive:${dMatch[0]}`);

    const written = _extractWrittenPaths(cmd);
    const writtenKb = [];
    for (const p of written) {
      const abs = path.isAbsolute(p) ? p : path.join(ctx.PROJECT_ROOT, p);
      if (!isFileIndexed(abs)) continue;
      const footer = buildFileEnrichment(abs);
      if (!footer) continue;
      const content = footer.trim().replace(/^\[HME\]\s*/, '');
      if (content) writtenKb.push(`${path.basename(abs)} ${content}`);
    }
    if (writtenKb.length > 0) parts.push(`wrote:${writtenKb.join('|')}`);

    if (parts.length === 0) return;
    const footer = `\n[HME] ${parts.join(' · ')}`;
    if (footer.length > MAX_FOOTER_BYTES) return;

    _appendToResult(toolResult, footer);
    ctx.markDirty();
    ctx.emit({ event: 'bash_enriched', cmd: cmd.slice(0, 60), bytes: footer.length });
  },
};
