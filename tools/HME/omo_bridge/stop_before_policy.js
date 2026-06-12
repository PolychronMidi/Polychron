const { assertUniversalEvent } = require('./universal_event');
const { evaluateWorkChecks, _testables } = require('../proxy/stop_chain/policies/work_checks');

function stopDenyFromResult(result = {}) {
  return {
    kind: 'deny',
    reason: result.reason || result.message || result.prompt || 'stop.before blocked by HME stop-chain',
    machineCode: result.code || result.reasonCode || 'hme_stop_chain_block',
    severity: 'critical',
  };
}

function defaultContextFromEvent(event, options = {}) {
  return {
    ...options.ctx,
    lastAssistantText: event.turn && event.turn.assistantText,
    transcriptPath: event.turn && event.turn.transcriptPath,
  };
}

function evaluateStopBefore(eventInput, options = {}) {
  const event = assertUniversalEvent(eventInput);
  if (event.phase !== 'stop.before') return { kind: 'allow' };
  if (typeof options.evaluate === 'function') {
    const result = options.evaluate(event, options);
    return result ? stopDenyFromResult(result) : { kind: 'allow' };
  }
  if (options.skipNativeWorkChecks) return { kind: 'allow' };
  const ctx = typeof options.contextFactory === 'function' ? options.contextFactory(event) : defaultContextFromEvent(event, options);
  const result = evaluateWorkChecks(ctx);
  return result ? stopDenyFromResult(result) : { kind: 'allow' };
}

const stopBeforeKernelPolicy = Object.freeze({
  name: 'hme-stop-chain',
  trust: 'kernel',
  phases: ['stop.before'],
  capabilities: { decisions: ['allow', 'deny'] },
  async handler(event, options = {}) {
    return evaluateStopBefore(event, options);
  },
});

module.exports = { WORK_CHECKS: _testables.WORK_CHECKS, evaluateStopBefore, stopBeforeKernelPolicy };
