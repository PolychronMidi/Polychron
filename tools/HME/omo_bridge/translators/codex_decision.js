const { guardDecision } = require('./common');

function translateCodexDecision(decision = {}, ctx = {}) {
  const phase = ctx.phase || 'tool.execute.before';
  const unsupported = guardDecision('codex', phase, decision);
  if (unsupported) return unsupported;
  if (decision.kind === 'deny') {
    return { stdout: '', stderr: decision.reason, exitCode: 1 };
  }
  if (decision.kind === 'ask_permission') {
    return { stdout: '', stderr: decision.prompt, exitCode: 2 };
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

module.exports = { translateCodexDecision };
