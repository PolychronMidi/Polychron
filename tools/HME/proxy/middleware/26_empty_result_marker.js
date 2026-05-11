'use strict';
/**
 * Empty-tool-result marker. Every tool execution should return at least a minimal success/fail message; empty bodies train the agent to treat absent signal as positive signal (the same antipattern this project flags in `>/dev/null 2>&1` redirects). When a tool_result lands with no body, this middleware appends a marker so the agent knows to verify (Read for file edits, rerun for diagnostics) rather than silently trusting the void.
 *
 * Idempotent via hasHmeFooter. Skipped for known-stub patterns (background task placeholders are resolved by 12_background_dominance.js) and for tool errors (which carry is_error=true and an explicit error message already).
 */

function _textOf(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

function _isError(toolResult) {
  return toolResult.is_error === true;
}

const _MARKER = '[empty-result-from-tool] no body returned -- verify via Read/rerun before treating as success';

module.exports = {
  name: 'empty_result_marker',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (_isError(toolResult)) return;
    const text = _textOf(toolResult);
    if (text && text.trim().length > 0) return;
    if (ctx.hasHmeFooter(toolResult, '[empty-result-from-tool]')) return;
    ctx.appendToResult(toolResult, _MARKER);
    ctx.markDirty();
    ctx.emit({ event: 'empty_tool_result_marked', tool: toolUse.name });
  },
};
