function isLiveDecision(decision = {}) {
  return !['allow', 'defer'].includes(decision.kind);
}

function externalLiveAllowed(plugin = {}, sandbox = {}) {
  return sandbox.allowExternalLive === true || plugin.allowExternalLive === true;
}

function sandboxViolation(plugin = {}, decision = {}, sandbox = {}) {
  if (plugin.trust !== 'external') return null;
  if (!isLiveDecision(decision)) return null;
  if (externalLiveAllowed(plugin, sandbox)) return null;
  return `${plugin.name || 'external plugin'} is external and cannot apply live ${decision.kind} decisions`;
}

module.exports = { externalLiveAllowed, isLiveDecision, sandboxViolation };
