'use strict';
// Auto-rewrite Agent tool calls that are missing the `description` parameter.
// Derives description from the first line / first 60 chars of the prompt.

function _deriveDescription(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return 'Subagent task';
  const firstLine = text.split(/\r?\n/)[0].trim();
  const base = firstLine || text;
  return base.length > 60 ? base.slice(0, 57).trimEnd() + '...' : base;
}

module.exports = {
  name: 'auto-fill-agent-description',
  description: 'Auto-fill missing Agent.description from prompt; eases recurring tool-call failures.',
  category: 'ergonomics',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Agent', 'Task'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    const hasDesc = typeof ti.description === 'string' && ti.description.trim().length > 0;
    if (hasDesc) return ctx.allow();
    const desc = _deriveDescription(ti.prompt);
    return ctx.rewrite({ ...ti, description: desc }, `DDoC stripped: auto-filled Agent.description="${desc}"`);
  },
};
