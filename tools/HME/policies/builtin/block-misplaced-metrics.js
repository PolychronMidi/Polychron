'use strict';
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
    if (!/\/metrics\//.test(fp)) return ctx.allow();
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    const expected = new RegExp('^' + projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/output/metrics/');
    if (expected.test(fp)) return ctx.allow();
    return ctx.deny(
      `BLOCKED: metrics/ only exists at output/metrics/. Path: ${fp}`
    );
  },
};
