'use strict';
const { isMisplacedMetricsPath, metricsMessage } = require('../../proxy/path_policy');
/**
 * Block writes to misplaced metrics/ directories. metrics/ exists only at
 * output/metrics/. Other paths usually mean a path-derivation bug.
 */

module.exports = {
  name: 'block-misplaced-metrics',
  description: 'Block writes to metrics/ outside output/metrics/.',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const fp = (ctx.toolInput && ctx.toolInput.file_path) || '';
    if (!isMisplacedMetricsPath(fp)) return ctx.allow();
    return ctx.deny(metricsMessage('write files in', fp));
  },
};
