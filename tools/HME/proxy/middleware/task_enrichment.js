'use strict';
/**
 * Task/Agent envelopment — scans subagent return text for referenced file
 * paths and appends a compact KB coverage summary for indexed hits with
 * HME coverage. Matches the grep_glob_neighborhood KB summary pattern,
 * so an agent reading a subagent's report gets the same pre-loaded
 * context as if it had grepped the files itself.
 */

const path = require('path');
const { isFileIndexed, buildFileEnrichment } = require('../context');

const MAX_FILES_SHOWN = 5;
const MAX_BYTES = 300;
const PATH_RE = /[\w./-]*[\w-]\/[\w./-]+\.(?:js|ts|tsx|py|sh|json|md|yaml|yml)\b/g;

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

module.exports = {
  name: 'task_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (toolUse.name !== 'Task') return;
    const text = _textOf(toolResult);
    if (!text) return;

    const seen = new Set();
    const hits = [];
    for (const match of text.matchAll(PATH_RE)) {
      const p = match[0];
      if (seen.has(p)) continue;
      seen.add(p);
      const abs = path.isAbsolute(p) ? p : path.join(ctx.PROJECT_ROOT, p);
      if (!isFileIndexed(abs)) continue;
      const footer = buildFileEnrichment(abs);
      if (!footer) continue;
      const content = footer.trim().replace(/^\[HME\]\s*/, '');
      if (content) hits.push(`${path.basename(abs)} ${content}`);
      if (hits.length >= MAX_FILES_SHOWN) break;
    }
    if (hits.length === 0) return;

    const note = `\n[HME KB] ${hits.join(' | ')}`;
    if (note.length > MAX_BYTES) return;

    _appendToResult(toolResult, note);
    ctx.markDirty();
    ctx.emit({ event: 'task_enriched', hits: hits.length, bytes: note.length });
  },
};
