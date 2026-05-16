'use strict';

const { emptyMarker, textOfToolResult } = require('../tool_result_semantics');

module.exports = {
  name: 'empty_result_marker',

  onToolResult({ toolUse, toolResult, ctx }) {
    const text = textOfToolResult(toolResult);
    if (text && text.trim().length > 0) return;
    if (ctx.hasHmeFooter(toolResult, '[SUCCESS]') || ctx.hasHmeFooter(toolResult, '[FAIL]')) return;
    ctx.appendToResult(toolResult, emptyMarker(toolResult.is_error === true));
    ctx.markDirty();
    ctx.emit({ event: 'empty_tool_result_marked', tool: toolUse.name, status: toolResult.is_error ? 'FAIL' : 'SUCCESS' });
  },
};
