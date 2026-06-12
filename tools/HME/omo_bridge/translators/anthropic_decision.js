const { guardDecision } = require('./common');

function translateAnthropicDecision(decision = {}, ctx = {}) {
  const phase = ctx.phase || 'chat.params';
  const unsupported = guardDecision('anthropic', phase, decision);
  if (unsupported) return unsupported;
  if (decision.kind === 'modify') return { requestPatch: decision.patch, appliedTo: 'body' };
  if (decision.kind === 'drop') return { streamAction: 'drop', target: 'content_block' };
  if (decision.kind === 'rewrite') return { streamAction: 'rewrite', text: decision.text };
  if (decision.kind === 'deny') return { blocked: true, reason: decision.reason };
  if (decision.kind === 'inject') return { injection: decision.payload, target: decision.target };
  return { allowed: true };
}

module.exports = { translateAnthropicDecision };
