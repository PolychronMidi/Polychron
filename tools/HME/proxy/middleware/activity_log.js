'use strict';
// Activity log middleware — emits activity events for every completed tool
// execution. Replaces log-tool-call.sh's transcript/activity emission and
// the various posttooluse_*.sh activity hooks.

function _extractModule(fp) {
  if (!fp) return '';
  const base = fp.split('/').pop() || '';
  return base.replace(/\.[^.]+$/, '');
}

module.exports = {
  name: 'activity_log',

  onToolResult({ toolUse, toolResult, session, ctx }) {
    const name = toolUse.name || '?';
    const input = toolUse.input || {};
    const filePath = input.file_path || input.path || '';
    const module = _extractModule(filePath);

    // Universal: log every tool call
    ctx.emit({
      event: 'tool_call',
      session,
      tool: name.replace(/[,=\s]/g, '_'),
      module: module || '',
      file: filePath || '',
    });

    // edit_pending is a PRE-event (emitted by pretooluse_edit.sh before the
    // tool runs). Middleware only sees POST-execution tool_results, so we
    // emit file_written for both Edit and Write to match the "just finished"
    // semantic. Shell hook retains the pre-event ownership.
    if (name === 'Edit' || name === 'NotebookEdit' || name === 'Write') {
      ctx.emit({
        event: 'file_written',
        session,
        file: filePath,
        module,
      });
    } else if (name && name.startsWith('mcp__HME__')) {
      // Rough elapsed proxy: tool_result is emitted immediately after run, we
      // don't have ms-precision timing here. Emit 0 so consumers that check
      // for the presence of the event still work.
      ctx.emit({
        event: 'mcp_tool_call',
        session,
        tool: name,
        elapsed_s: 0,
      });
    }
  },
};
