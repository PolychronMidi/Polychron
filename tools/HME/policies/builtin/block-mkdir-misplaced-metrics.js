'use strict';
/**
 * Block `mkdir <path-with-/metrics/>` outside output/metrics/. JS port of
 * the corresponding gate in blackbox_guards.sh.
 */

const HAS_MKDIR = /\bmkdir\b/;
const HAS_NESTED_METRICS = /\/metrics($|\/)/;

module.exports = {
  name: 'block-mkdir-misplaced-metrics',
  description: 'Block `mkdir` of metrics/ outside output/metrics/.',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (!HAS_MKDIR.test(cmd) || !HAS_NESTED_METRICS.test(cmd)) return ctx.allow();
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    const escaped = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const allowed = new RegExp('"?' + escaped + '/output/metrics');
    if (allowed.test(cmd)) return ctx.allow();
    return ctx.deny(
      'BLOCKED: metrics/ only exists at output/metrics/. Do not mkdir any other metrics/ directory.'
    );
  },
};
