'use strict';
/**
 * Edit/Write enrichment — appends the same HME coverage footer that
 * read_enrichment.js adds to Read results, so the agent sees KB staleness,
 * jurisdiction constraints, bias bounds, and drift warnings immediately
 * after an edit lands — no separate read required.
 *
 * Also fires a background /reindex on the edited file so KB coverage stays
 * current for subsequent searches. The reindex is fully fire-and-forget:
 * it never blocks the edit result or adds latency.
 *
 * Scope gate: indexed files only (same as read_enrichment).
 */

const http = require('http');
const { isFileIndexed, buildFileEnrichment } = require('../context');
const { MCP_PORT } = require('../supervisor/children');

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

function _reindexAsync(filePath) {
  const body = Buffer.from(JSON.stringify({ files: [filePath] }), 'utf8');
  const req = http.request({
    hostname: '127.0.0.1', port: MCP_PORT, path: '/reindex', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
  });
  req.on('error', () => { /* fire-and-forget; worker may not be up yet */ });
  req.setTimeout(30_000, () => req.destroy());
  req.write(body);
  req.end();
}

module.exports = {
  name: 'edit_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    const name = toolUse.name || '';
    if (name !== 'Edit' && name !== 'Write' && name !== 'NotebookEdit') return;

    const filePath = (toolUse.input && toolUse.input.file_path) || '';
    if (!filePath) return;
    if (!isFileIndexed(filePath)) return;

    // Background reindex — never awaited, never blocks.
    _reindexAsync(filePath);

    const footer = buildFileEnrichment(filePath);
    if (!footer) return;

    _appendToResult(toolResult, '\n' + footer);
    ctx.markDirty();
    ctx.emit({ event: 'edit_enriched', file: filePath, bytes: footer.length });
  },
};
