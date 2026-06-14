'use strict';

const { emptyMarker, textOfToolResult } = require('../tool_result_semantics');
const quality = require('../tool_response_quality');
const invalidators = require('../claim_invalidators');

module.exports = {
  name: 'empty_result_marker',

  onToolResult({ toolUse, toolResult, ctx }) {
    const text = textOfToolResult(toolResult);
    if (text && text.trim().length > 0) return;
    if (ctx.hasHmeFooter(toolResult, '[SUCCESS]') || ctx.hasHmeFooter(toolResult, '[FAIL]') || ctx.hasHmeFooter(toolResult, '[NO_OUTPUT]')) return;
    const status = toolResult.is_error ? 'FAIL' : 'NO_OUTPUT';
    ctx.appendToResult(toolResult, emptyMarker(toolResult.is_error === true));
    ctx.markDirty();
    ctx.emit({ event: 'empty_tool_result_marked', tool: toolUse.name, status });
    if (toolResult.is_error === true) {
      quality.record({
        tool: toolUse.name,
        rating: 0,
        defect_class: 'false_no_output',
        defect: 'tool errored with empty body',
        owner: 'tool-wrapper',
        reproduction: `run ${toolUse.name} and inspect empty error body`,
        regression: 'test_empty_result_marker.js',
        contract_violation: true,
      });
      invalidators.appendInvalidator({ key: 'tool_response_defect', subject_uri: 'session://tool-response', source: 'empty_result_marker', detail: `${toolUse.name} empty error body` });
    }
  },
};
