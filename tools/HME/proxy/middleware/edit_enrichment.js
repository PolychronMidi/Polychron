'use strict';
/**
 * Edit/Write enrichment — appends the same HME coverage footer that
 * read_enrichment.js adds to Read results, so the agent sees KB staleness,
 * jurisdiction constraints, bias bounds, and drift warnings immediately
 * after an edit lands — no separate read required.
 *
 * Reindexing is NOT triggered here. A file watcher handles that
 * automatically — firing /reindex per edit would double-schedule work.
 *
 * Scope gate: indexed files only (same as read_enrichment).
 */

const { isFileIndexed, buildFileEnrichment } = require('../context');

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
  name: 'edit_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    const name = toolUse.name || '';
    if (name !== 'Edit' && name !== 'Write' && name !== 'NotebookEdit') return;

    const filePath = (toolUse.input && toolUse.input.file_path) || '';
    if (!filePath) return;
    if (!isFileIndexed(filePath)) return;

    const footer = buildFileEnrichment(filePath);
    if (!footer) return;

    _appendToResult(toolResult, '\n' + footer);
    ctx.markDirty();
    ctx.emit({ event: 'edit_enriched', file: filePath, bytes: footer.length });
  },
};
