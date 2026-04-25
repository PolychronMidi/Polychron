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
    // Renamed from `module` because that shadows the CommonJS-injected
    // per-file `module` binding — silent footgun if a future edit ever
    // reaches for `module.exports` or any reflection inside this scope.
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
    // tool runs). Middleware only sees POST-execution tool_results, so we
    // emit file_written for both Edit and Write to match the "just finished"
    // semantic. Shell hook retains the pre-event ownership.
    if (name === 'Edit' || name === 'NotebookEdit' || name === 'Write') {
      // Compute hme_read_prior: was this file (or its module) recently
      // briefed via Read / HME tool / Grep? Without this field,
      // coherence-score read_coverage is always 0/N — the root cause of
      // the cascade of zero-valued Phase 2-6 metrics.
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
