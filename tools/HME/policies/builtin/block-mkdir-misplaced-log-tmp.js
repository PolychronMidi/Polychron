'use strict';
const { PROJECT_ROOT } = require('../../proxy/shared');
const {
  hasMkdir,
  mkdirHasMisplacedRootOnlyDir,
  rootOnlyDirMessage,
} = require('../../proxy/path_policy');
/**
 * Block `mkdir <path-with-/log-or-/tmp-/>` outside the project root.
 * Bash analog of the file-write block-misplaced-log-tmp policy, but for
 * Bash mkdir commands instead of Write/Edit. JS port of the gate in
 * blackbox_guards.sh.
 */

module.exports = {
  name: 'block-mkdir-misplaced-log-tmp',
  description: 'Block `mkdir` of log/ or tmp/ subdirectories outside the project root.',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (!hasMkdir(cmd)) return ctx.allow();
    const projectRoot = process.env.PROJECT_ROOT || PROJECT_ROOT;
    if (!mkdirHasMisplacedRootOnlyDir(cmd, ['log', 'tmp'], projectRoot)) return ctx.allow();
    return ctx.deny(rootOnlyDirMessage('mkdir', projectRoot));
  },
};
