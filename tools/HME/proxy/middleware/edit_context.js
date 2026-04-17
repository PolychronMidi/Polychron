'use strict';
/**
 * Edit context — fires on Edit/Write/NotebookEdit when the target file has
 * bias-bounds locked in scripts/pipeline/bias-bounds-manifest.json. Shows
 * the exact locked parameters with their current [lo, hi] ranges and the
 * snapshot command the agent must run if the new bounds are intentional.
 *
 * For Edit specifically: if old_string or new_string mentions one of the
 * manifest keys, it's treated as a HIGH-signal hit (the edit is definitely
 * touching a locked param) and gets an `⚠` prefix.
 *
 * Silent for files with no locked bias — which is the vast majority.
 */

const path = require('path');
const { biasBoundsFor } = require('../context');

const SNAPSHOT_CMD = 'node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds';

function _relPath(fp, projectRoot) {
  if (!fp) return '';
  if (fp.startsWith(projectRoot + '/')) return fp.slice(projectRoot.length + 1);
  return fp;
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
  name: 'edit_context',

  onToolResult({ toolUse, toolResult, ctx }) {
    const tool = toolUse.name || '';
    if (tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') return;

    const fp = (toolUse.input && toolUse.input.file_path) || '';
    if (!fp) return;
    const rel = _relPath(fp, ctx.PROJECT_ROOT);

    const locks = biasBoundsFor(rel);
    if (locks.length === 0) return;

    // Detect whether the edit directly touches any of the locked keys.
    const oldStr = (toolUse.input && toolUse.input.old_string) || '';
    const newStr = (toolUse.input && toolUse.input.new_string) || (toolUse.input && toolUse.input.content) || '';
    const touched = locks.filter((l) => {
      // Match the key literal or the short suffix after the colon
      const short = l.key.includes(':') ? l.key.split(':').pop() : l.key;
      if (!short || short.length < 3) return false;
      return oldStr.includes(short) || newStr.includes(short);
    });

    const prefix = touched.length > 0 ? '⚠ ' : '';
    const shown = (touched.length > 0 ? touched : locks).slice(0, 4)
      .map((l) => `${l.key}=[${l.lo},${l.hi}]`)
      .join(', ');
    const tail = (touched.length > 0 ? touched : locks).length > 4
      ? ` (+${(touched.length > 0 ? touched : locks).length - 4} more)`
      : '';
    const verb = touched.length > 0
      ? 'edit mentions locked bias key(s)'
      : 'file has locked bias bounds';

    const footer = `\n[HME] ${prefix}${verb}: ${shown}${tail} — if intentional, snapshot with: ${SNAPSHOT_CMD}`;
    _appendToResult(toolResult, footer);
    ctx.markDirty();
    ctx.emit({ event: 'edit_context_bias', file: rel, touched: touched.length, locks: locks.length });
  },
};
