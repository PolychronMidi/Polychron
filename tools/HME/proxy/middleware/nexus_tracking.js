'use strict';
// NEXUS backlog tracking — adds EDIT entries on Edit/Write for src/ or
// tools/HME/ paths, clears BRIEF on new edits, sets BRIEF on mcp__HME__read.
// Replaces posttooluse_edit.sh, posttooluse_write.sh, posttooluse_hme_read.sh,
// posttooluse_hme_review.sh EDIT tracking.

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

    if (name === 'mcp__HME__read') {
      // Track the BRIEF marker so downstream pretooluse checks see read-prior.
      const target = input.target || input.module || input.file_path || '';
      if (target) ctx.nexusAdd('BRIEF', String(target));
    }

    if (name === 'mcp__HME__review') {
      const count = ctx.nexusCount('EDIT');
      ctx.nexusClearType('EDIT');
      ctx.nexusMark('REVIEW', String(count));
      ctx.emit({ event: 'review_complete', cleared: count });
    }
  },
};
