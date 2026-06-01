const { toUniversalClaudeEvent } = require('./adapters/claude_inbound');
const { toUniversalCodexEvent } = require('./adapters/codex_inbound');
const { toUniversalOpenAiEvent } = require('./adapters/openai_inbound');
const { assertUniversalEvent } = require('./universal_event');
const { resolveUniversalDecisions } = require('./decision_resolver');
const { translateAnthropicDecision } = require('./translators/anthropic_decision');
const { translateClaudeDecision } = require('./translators/claude_decision');
const { translateCodexDecision } = require('./translators/codex_decision');
const { translateOpenAiDecision } = require('./translators/openai_decision');
const { translateOpenCodeDecision } = require('./translators/opencode_decision');

const TOOL_ADAPTERS = Object.freeze({ claude: toUniversalClaudeEvent, codex: toUniversalCodexEvent, openai: toUniversalOpenAiEvent });
const TOOL_TRANSLATORS = Object.freeze({ anthropic: translateAnthropicDecision, claude: translateClaudeDecision, codex: translateCodexDecision, openai: translateOpenAiDecision, opencode: translateOpenCodeDecision });

function toToolEvent(input, options = {}) {
  if (input && input.abi === 'hme-opencode-hook/v1') return assertUniversalEvent(input);
  const host = options.host || 'claude';
  const adapter = TOOL_ADAPTERS[host];
  if (!adapter) throw new Error(`No tool gate adapter for ${host}`);
  return adapter(input, options);
}

async function runMandatoryPolicies(event, policies = []) {
  const decisions = [];
  for (const policy of policies) {
    try {
      const evaluate = typeof policy === 'function' ? policy : policy.evaluate;
      const decision = await evaluate(event);
      decisions.push({ decision: decision || { kind: 'allow' }, plugin: policy.name || 'mandatory_policy', trust: 'kernel' });
    } catch (error) {
      decisions.push({
        decision: { kind: 'deny', reason: `Mandatory policy failed: ${error.message}`, machineCode: 'mandatory_policy_failed', severity: 'critical' },
        plugin: policy.name || 'mandatory_policy',
        trust: 'kernel',
      });
    }
  }
  return decisions;
}

async function routeToolGate(input, options = {}) {
  const event = toToolEvent(input, options);
  const host = options.outputHost || options.host || event.source.host;
  const translator = TOOL_TRANSLATORS[host];
  const mandatory = await runMandatoryPolicies(event, options.mandatoryPolicies || []);
  const plugin = options.pluginHost ? await options.pluginHost.invokePhase(event, { host }) : { results: [], decisions: [] };
  const pluginRecords = (plugin.results || []).filter((item) => item.applied && item.decision);
  const resolution = resolveUniversalDecisions([...mandatory, ...pluginRecords]);
  const output = translator ? translator(resolution.decision, { phase: event.phase }) : { unsupported: true, host, phase: event.phase };
  return { event, output, resolution, pluginResult: plugin };
}

module.exports = { TOOL_ADAPTERS, TOOL_TRANSLATORS, routeToolGate, runMandatoryPolicies };
