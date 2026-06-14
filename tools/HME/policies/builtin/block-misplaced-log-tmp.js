'use strict';
const { PROJECT_ROOT } = require('../../proxy/shared');
const { isMisplacedRootOnlyDir, rootOnlyDirMessage } = require('../../proxy/path_policy');
// Block writes to nested log/tmp directories; only PROJECT_ROOT/log and /tmp are valid.
// Mirrors the write-hook guard against path-resolution bugs.

module.exports = {
  name: 'block-misplaced-log-tmp',
  description: 'Block writes to log/ or tmp/ outside the project root (defends against path-resolution bugs).',
  category: 'consistency',
  defaultEnabled: true,
  decisionClass: 'block',
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const fp = (ctx.toolInput && ctx.toolInput.file_path) || '';
    const projectRoot = ctx.projectRoot || PROJECT_ROOT;
    if (!isMisplacedRootOnlyDir(fp, ['log', 'tmp'], projectRoot)) return ctx.allow();
    return ctx.deny(rootOnlyDirMessage('write', projectRoot, `Path: ${fp}`));
  },
};
