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
const { validate } = require('../worker_client');

const SNAPSHOT_CMD = 'node scripts/pipeline/validators/check-hypermeta-jurisdiction.js --snapshot-bias-bounds';

// Thresholds tuned so only high-signal KB matches surface.
const BUGFIX_MIN_SCORE = 0.45;
const ANTIPATTERN_MIN_SCORE = 0.45;

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

  async onToolResult({ toolUse, toolResult, ctx }) {
    const tool = toolUse.name || '';
    if (tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') return;

    const fp = (toolUse.input && toolUse.input.file_path) || '';
    if (!fp) return;
    const rel = _relPath(fp, ctx.PROJECT_ROOT);

    // Semantic validate — module stem is the query; /validate returns
    // bugfix/antipattern hits if the KB has relevant entries. Surface as
    // warning, title-only. Fires for every Edit/Write/NotebookEdit.
    const stem = path.basename(fp, path.extname(fp));
    const semanticLines = [];
    const semantic = await validate(stem);
    if (semantic && typeof semantic === 'object') {
      const blocks = Array.isArray(semantic.blocks) ? semantic.blocks : [];
      const warnings = Array.isArray(semantic.warnings) ? semantic.warnings : [];
      for (const b of blocks) {
        if (typeof b.score === 'number' && b.score >= BUGFIX_MIN_SCORE) {
          const t = String(b.title ? b.title : '').slice(0, 90);
          if (t) semanticLines.push(`⚠ bugfix:"${t}"`);
          if (semanticLines.length >= 1) break;
        }
      }
      for (const w of warnings) {
        if (semanticLines.length >= 2) break;
        if (typeof w.score === 'number' && w.score >= ANTIPATTERN_MIN_SCORE) {
          const t = String(w.title ? w.title : '').slice(0, 90);
          if (t) semanticLines.push(`⚠ rule:"${t}"`);
        }
      }
    }

    const locks = biasBoundsFor(rel);
    if (locks.length === 0 && semanticLines.length === 0) return;

    // Detect whether the edit directly touches any of the locked keys.
    const oldStr = (toolUse.input && toolUse.input.old_string) || '';
    const newStr = (toolUse.input && toolUse.input.new_string) || (toolUse.input && toolUse.input.content) || '';
    const touched = locks.filter((l) => {
      // Match the key literal or the short suffix after the colon
      const short = l.key.includes(':') ? l.key.split(':').pop() : l.key;
      if (!short || short.length < 3) return false;
      return oldStr.includes(short) || newStr.includes(short);
    });

    const footerLines = [];
    if (locks.length > 0) {
      const src = touched.length > 0 ? touched : locks;
      const shown = src.slice(0, 3).map((l) => `${l.key}=[${l.lo},${l.hi}]`).join(' ');
      const tail = src.length > 3 ? ` +${src.length - 3}` : '';
      const tag = touched.length > 0 ? '⚠ bias-touch' : 'bias-bounds';
      footerLines.push(`${tag}: ${shown}${tail} — snapshot:${SNAPSHOT_CMD}`);
    }
    for (const line of semanticLines) footerLines.push(line);

    if (ctx.hasHmeFooter(toolResult)) return;
    const footer = '\n[HME] ' + footerLines.join(' | ');
    _appendToResult(toolResult, footer);
    ctx.markDirty();
    ctx.emit({
      event: 'edit_context',
      file: rel,
      touched: touched.length,
      locks: locks.length,
      semantic: semanticLines.length,
    });
  },
};
