'use strict';
const { PROJECT_ROOT } = require('../../proxy/shared');
const { isMisplacedRootOnlyDir, rootOnlyDirMessage } = require('../../proxy/path_policy');
/**
 * Block writes to misplaced log/ or tmp/ subdirectories. log/ and tmp/
 * exist ONLY at the project root; nested variants under src/ or
 * tools/HME/ etc. are bugs (often from BASH_SOURCE-relative path math
 * that landed in a wrong root). JS port of the bash gate in
 * pretooluse_write.sh.
 */

module.exports = {
  name: 'block-misplaced-log-tmp',
  description: 'Block writes to log/ or tmp/ outside the project root (defends against path-resolution bugs).',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const fp = (ctx.toolInput && ctx.toolInput.file_path) || '';
    const projectRoot = process.env.PROJECT_ROOT || PROJECT_ROOT;
    if (!isMisplacedRootOnlyDir(fp, ['log', 'tmp'], projectRoot)) return ctx.allow();
    return ctx.deny(rootOnlyDirMessage('write', projectRoot, `Path: ${fp}`));
  },
};
