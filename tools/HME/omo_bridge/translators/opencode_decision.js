const { guardDecision } = require('./common');

function translateOpenCodeDecision(decision = {}, ctx = {}) {
  const phase = ctx.phase || 'permission.ask';
  const unsupported = guardDecision('opencode', phase, decision);
  if (unsupported) return unsupported;
  if (decision.kind === 'ask_permission') {
    return { decision: { behavior: 'ask', message: decision.prompt, choices: decision.choices || [], default: decision.default || '' } };
  }
  if (decision.kind === 'deny') return { decision: { behavior: 'deny', message: decision.reason } };
  if (decision.kind === 'modify') return { decision: { behavior: 'modify', patch: decision.patch, target: decision.target } };
  return { decision: { behavior: 'allow' } };
}

module.exports = { translateOpenCodeDecision };
