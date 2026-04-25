'use strict';
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
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    // Match anything containing /log/ or /tmp/ that isn't anchored at projectRoot.
    if (!/\/(log|tmp)\//.test(fp)) return ctx.allow();
    const expected = new RegExp('^' + projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(log|tmp)/');
    if (expected.test(fp)) return ctx.allow();
    return ctx.deny(
      `BLOCKED: log/ and tmp/ only exist at the project root (${projectRoot}/{log,tmp}/). Do not write files inside subdirectory variants. Path: ${fp}`
    );
  },
};
