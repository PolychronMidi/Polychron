'use strict';
// Activity log middleware -- emits activity events for every completed tool
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
    // Renamed from `module` because that shadows the CommonJS-injected
    const moduleName = _extractModule(filePath);

    // Universal: log every tool call
    ctx.emit({
      event: 'tool_call',
      session,
      tool: name.replace(/[,=\s]/g, '_'),
      module: moduleName || '',
      file: filePath || '',
    });

    // edit_pending is a PRE-event (emitted by pretooluse_edit.sh before the
    if (name === 'Edit' || name === 'NotebookEdit' || name === 'Write') {
      // Compute hme_read_prior: was this file (or its module) recently
      const hmeReadPrior = (ctx.nexusHas && (
        (moduleName && ctx.nexusHas('BRIEF', moduleName)) ||
        (filePath && ctx.nexusHas('BRIEF', filePath))
      )) === true;
      ctx.emit({
        event: 'file_written',
        session,
        file: filePath,
        module: moduleName,
        hme_read_prior: hmeReadPrior,
        source: 'proxy_tool',  // Distinguishes agent Edit/Write from fs_watcher + pipeline_script
      });
    } else if (name && name.startsWith('HME_')) {
      // Rough elapsed proxy: tool_result is emitted immediately after run, we
      ctx.emit({
        event: 'mcp_tool_call',
        session,
        tool: name,
        elapsed_s: 0,
      });
    }
  },
};
