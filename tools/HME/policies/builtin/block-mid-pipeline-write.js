'use strict';
const { requireEnv: _hmeRequireEnv } = require('../../proxy/shared/load_env.js');
// Block src writes while a pipeline is running because it measures launch-time code.
// JS policy mirrors write/edit bash gates for proxy and direct-mode defense-in-depth.

const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'block-mid-pipeline-write',
  description: 'Block writes/edits to src/ while a pipeline run is in progress (tmp/run.lock exists).',
  category: 'consistency',
  defaultEnabled: true,
  decisionClass: 'block',
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const fp = (ctx.toolInput && ctx.toolInput.file_path) || '';
    if (!fp.includes('/Polychron/src/')) return ctx.allow();
    const projectRoot = _hmeRequireEnv('PROJECT_ROOT');
    const lockFile = path.join(projectRoot, 'tmp', 'run.lock');
    if (!fs.existsSync(lockFile)) return ctx.allow();
    return ctx.deny(
      'ABANDONED PIPELINE: npm run main is running (tmp/run.lock present). Do NOT write src/ code mid-pipeline -- the pipeline\'s behavior is being measured against the code state at launch. Wait for completion; use HME tools or edit tooling/docs in the meantime.'
    );
  },
};
