const { guardDecision, hookEventName } = require('./common');

function translateClaudeDecision(decision = {}, ctx = {}) {
  const phase = ctx.phase || 'tool.execute.before';
  const unsupported = guardDecision('claude', phase, decision);
  if (unsupported) return unsupported;
  if (decision.kind === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: ctx.hookEventName || hookEventName(phase),
        permissionDecision: 'deny',
        permissionDecisionReason: decision.reason,
      },
    };
  }
  if (decision.kind === 'ask_permission') {
    return { hookSpecificOutput: { hookEventName: ctx.hookEventName || hookEventName(phase), permissionDecision: 'ask', permissionDecisionReason: decision.prompt } };
  }
  return { hookSpecificOutput: { hookEventName: ctx.hookEventName || hookEventName(phase), permissionDecision: 'allow' } };
}

module.exports = { translateClaudeDecision };
