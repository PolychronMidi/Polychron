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

    // Tool-specific events that old shell hooks emitted:
    if (name === 'Edit' || name === 'NotebookEdit') {
      ctx.emit({
        event: 'edit_pending',
        session,
        file: filePath,
        module,
      });
    } else if (name === 'Write') {
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
