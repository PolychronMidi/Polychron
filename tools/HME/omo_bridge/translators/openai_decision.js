const { guardDecision } = require('./common');

function translateOpenAiDecision(decision = {}, ctx = {}) {
  const phase = ctx.phase || 'tool.execute.before';
  const unsupported = guardDecision('openai', phase, decision);
  if (unsupported) return unsupported;
  if (decision.kind === 'modify') return { requestPatch: decision.patch, appliedTo: 'body' };
  if (decision.kind === 'drop') return { streamAction: 'drop', target: 'content_block' };
  if (decision.kind === 'rewrite') return { streamAction: 'rewrite', text: decision.text };
  if (decision.kind === 'deny') return { toolResult: { error: decision.reason, denied: true } };
  if (decision.kind === 'inject') return { injection: decision.payload, target: decision.target };
  return { allowed: true };
}

module.exports = { translateOpenAiDecision };
