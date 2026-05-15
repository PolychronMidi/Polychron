'use strict';
const { hasMkdir, mkdirHasMisplacedMetrics, metricsMessage } = require('../../proxy/path_policy');
/**
 * Block `mkdir <path-with-/metrics/>` outside output/metrics/. JS port of
 * the corresponding gate in blackbox_guards.sh.
 */

module.exports = {
  name: 'block-mkdir-misplaced-metrics',
  description: 'Block `mkdir` of metrics/ outside output/metrics/.',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (!hasMkdir(cmd) || !mkdirHasMisplacedMetrics(cmd)) return ctx.allow();
    return ctx.deny(metricsMessage('mkdir'));
  },
};
