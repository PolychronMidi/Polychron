'use strict';
/**
 * Block writes/edits to src/ while a pipeline is running (tmp/run.lock
 * exists). The pipeline's behavior is being measured against the code
 * state at launch; mid-run src changes invalidate that. JS port of the
 * gate at the top of pretooluse_write.sh + pretooluse_edit.sh.
 *
 * Bash counterpart remains for direct-mode (proxy down) defense-in-depth.
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'block-mid-pipeline-write',
  description: 'Block writes/edits to src/ while a pipeline run is in progress (tmp/run.lock exists).',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const fp = (ctx.toolInput && ctx.toolInput.file_path) || '';
    if (!fp.includes('/Polychron/src/')) return ctx.allow();
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    const lockFile = path.join(projectRoot, 'tmp', 'run.lock');
    if (!fs.existsSync(lockFile)) return ctx.allow();
    return ctx.deny(
      'ABANDONED PIPELINE: npm run main is running (tmp/run.lock present). Do NOT write src/ code mid-pipeline — the pipeline\'s behavior is being measured against the code state at launch. Wait for completion; use HME tools or edit tooling/docs in the meantime.'
    );
  },
};
