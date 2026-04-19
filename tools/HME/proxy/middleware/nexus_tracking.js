'use strict';
// NEXUS backlog tracking — adds EDIT entries on Edit/Write for src/ or
// tools/HME/ paths, clears BRIEF on new edits, sets BRIEF on HME_read.
// _stripHmePrefixOutgoing normalizes mcp__HME__* → HME_* before middleware
// runs, so all name checks here use the canonical HME_ prefix.

function _extractModule(fp) {
  if (!fp) return '';
  return (fp.split('/').pop() || '').replace(/\.[^.]+$/, '');
}

function _isTrackedPath(fp) {
  if (!fp) return false;
  return /\/(src|tools\/HME\/(mcp|chat|activity|hooks|scripts|proxy))\//.test(fp);
}

module.exports = {
  name: 'nexus_tracking',

  onToolResult({ toolUse, toolResult, ctx }) {
    const name = toolUse.name || '';
    const input = toolUse.input || {};
    const fp = input.file_path || input.path || '';

    if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && _isTrackedPath(fp)) {
      ctx.nexusAdd('EDIT', fp);
    }

    if (name === 'HME_read') {
      // Track the BRIEF marker so downstream pretooluse checks see read-prior.
      const target = input.target || input.module || input.file_path || '';
      if (target) ctx.nexusAdd('BRIEF', String(target));
    }

    if (name === 'Read' && _isTrackedPath(fp)) {
      // Silent KB enrichment: reading a tracked src/ file auto-marks BRIEF,
      // same effect as an explicit i/hme-read call.
      ctx.nexusAdd('BRIEF', _extractModule(fp));
    }

    if (name === 'HME_review') {
      const count = ctx.nexusCount('EDIT');
      ctx.nexusClearType('EDIT');
      ctx.nexusMark('REVIEW', String(count));
      ctx.emit({ event: 'review_complete', cleared: count });
    }

    // Also detect review invocations via the Bash wrapper (i/review). The
    // old MCP tool HME_review no longer exists — the current agent path is
    // Bash(`i/review mode=forget`) which dispatches via scripts/hme-cli.js.
    // Without this, nexus would never see review events and stop.sh would
    // block indefinitely after each edit.
    if (name === 'Bash') {
      const cmd = String(input.command || '');
      if (/\bi\/review\b/.test(cmd)) {
        const count = ctx.nexusCount('EDIT');
        ctx.nexusClearType('EDIT');
        ctx.nexusMark('REVIEW', String(count));
        ctx.emit({ event: 'review_complete', cleared: count, via: 'bash_wrapper' });
      }
    }
  },
};
