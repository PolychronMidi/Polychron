'use strict';
/**
 * Read augmentation — when a native `Read` tool_result comes back for a
 * file that's within the RAG-indexed scope AND has HME coverage (KB entries,
 * bias bounds, open hypotheses, drift warnings, or jurisdiction zone), append
 * a compact enrichment footer to the tool_result content. Native file
 * contents are preserved verbatim; the footer is pure addition.
 *
 * Scope:
 *   - File must be within one of `.mcp.json`'s `ragIndexDirs` (via
 *     context.isFileIndexed). Out-of-scope files pass through unchanged.
 *   - File must have HME coverage (via context.buildFileEnrichment). Indexed
 *     files with no KB/bias/hypotheses metadata also pass through unchanged.
 *
 * Latency: enrichment uses only already-loaded maps (staleness, bias,
 * hypotheses, drift) — no network calls, no RAG queries. Typical cost
 * under 1ms.
 *
 * The middleware fires on every tool_use/tool_result pair where the use is
 * Read. Deduplication is handled by the framework (one fire per tool_use_id
 * across the proxy lifetime).
 */

const { isFileIndexed, buildFileEnrichment } = require('../context');

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

module.exports = {
  name: 'read_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (toolUse.name !== 'Read') return;
    const filePath = (toolUse.input && toolUse.input.file_path) || '';
    if (!filePath) return;

    // Scope gate: indexed files only.
    if (!isFileIndexed(filePath)) return;

    const footer = buildFileEnrichment(filePath);
    if (!footer) return;

    _appendToResult(toolResult, '\n' + footer);
    ctx.markDirty();
    ctx.emit({
      event: 'read_enriched',
      file: filePath,
      bytes: footer.length,
    });
  },
};
