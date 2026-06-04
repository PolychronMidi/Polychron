'use strict';

const { agentLeashContract } = require('../../proxy/coherence_organs');

module.exports = {
  name: 'agent-leash-contract',
  description: 'Require real Agent launches to carry scope, max duration, max tool calls, and expected artifact.',
  category: 'agent-discipline',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Agent', 'Task'] },
  params: {},
  async fn(ctx) {
    if (ctx.payload && ctx.payload._hme_synthetic_tool) return ctx.allow();
    const verdict = agentLeashContract(ctx.toolInput || {});
    if (verdict.ok) return ctx.allow();
    return ctx.deny(`BLOCKED: ${verdict.reason}`);
  },
};
