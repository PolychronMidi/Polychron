const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { routeChatParams, validatePatch } = require('../../omo_bridge/chat_params_routing');
const { resolveUniversalDecisions } = require('../../omo_bridge/decision_resolver');
const { createUniversalOpenCodeHost } = require('../../omo_bridge/opencode_host');
const { routeObservationEvent } = require('../../omo_bridge/observation_routing');
const { evaluateStopBefore, stopBeforeKernelPolicy, WORK_CHECKS } = require('../../omo_bridge/stop_before_policy');
const { evaluateStreamTextBlock, streamTextBlockPolicy } = require('../../omo_bridge/stream_text_block_policy');
const { routeToolGate, runMandatoryPolicies } = require('../../omo_bridge/tool_gate_routing');

function event(phase, extra = {}) {
  return {
    abi: 'hme-opencode-hook/v1',
    id: `${phase}-fixture`,
    timestamp: '2026-05-25T00:00:00.000Z',
    source: { host: extra.host || 'opencode', adapter: 'pipeline_test', rawEventName: phase },
    session: { id: 's1', provider: extra.host || 'opencode' },
    context: {},
    ...extra,
    phase,
  };
}

function permissionEvent() {
  return event('permission.ask', {
    host: 'opencode',
    permission: { action: 'run', target: 'Bash', risk: 'high' },
    tool: { name: 'Bash', input: { command: 'echo ok' } },
  });
}

function toolEvent(host = 'claude') {
  return event('tool.execute.before', {
    host,
    source: { host, adapter: 'pipeline_test', rawEventName: 'PreToolUse' },
    tool: { name: 'Bash', input: { command: 'echo ok' } },
  });
}

test('Phase 5 plugin host orders plugins and kernel deny wins', async () => {
  const seen = [];
  const host = createUniversalOpenCodeHost({ host: 'opencode' });
  host.registerPlugin({
    name: 'external-allow',
    trust: 'external',
    phases: ['permission.ask'],
    capabilities: { decisions: ['allow'] },
    handler() { seen.push('external-allow'); return { kind: 'allow' }; },
  });
  host.registerPlugin({
    name: 'kernel-deny',
    trust: 'kernel',
    order: 99,
    phases: ['permission.ask'],
    capabilities: { decisions: ['deny'] },
    handler() { seen.push('kernel-deny'); return { kind: 'deny', reason: 'kernel block', severity: 'critical' }; },
  });

  const result = await host.invokePhase(permissionEvent());
  assert.deepEqual(seen, ['kernel-deny', 'external-allow']);
  assert.equal(result.results.every((item) => item.status === 'applied'), true);
  assert.equal(result.primaryDecision.kind, 'deny');
  assert.equal(result.primaryDecision.reason, 'kernel block');
});

test('Phase 5 plugin host contains throw timeout invalid decision and capability violation', async () => {
  const host = createUniversalOpenCodeHost({
    host: 'opencode',
    timeoutMs: { 'tool.execute.before': 1, 'permission.ask': 25 },
    plugins: [
      { name: 'observe-deny', phases: ['permission.ask'], handler: () => ({ kind: 'deny', reason: 'not allowed by caps' }) },
      { name: 'invalid', phases: ['permission.ask'], capabilities: { decisions: ['*'] }, handler: () => ({ kind: 'bogus' }) },
      { name: 'thrower', phases: ['permission.ask'], capabilities: { decisions: ['allow'] }, handler: () => { throw new Error('boom'); } },
      { name: 'timeout', trust: 'kernel', mandatory: true, phases: ['tool.execute.before'], capabilities: { decisions: ['allow'] }, handler: () => new Promise(() => {}) },
    ],
  });

  const permission = await host.invokePhase(permissionEvent());
  assert.equal(permission.results.find((item) => item.plugin === 'observe-deny').status, 'capability_violation');
  assert.equal(permission.results.find((item) => item.plugin === 'invalid').status, 'invalid_decision');
  assert.equal(permission.results.find((item) => item.plugin === 'thrower').status, 'error');
  assert.equal(permission.primaryDecision.kind, 'allow');

  const timeout = await host.invokePhase(toolEvent('opencode'));
  assert.equal(timeout.results[0].status, 'timeout');
  assert.equal(timeout.primaryDecision.kind, 'deny');
  assert.equal(timeout.primaryDecision.machineCode, 'opencode_plugin_timeout');
});

test('Phase 6 decision resolver preserves precedence and patch conflict behavior', () => {
  const kernelDeny = resolveUniversalDecisions([
    { plugin: 'optional', decision: { kind: 'allow' } },
    { plugin: 'kernel', trust: 'kernel', decision: { kind: 'deny', reason: 'kernel stop' } },
  ]);
  assert.equal(kernelDeny.decision.kind, 'deny');
  assert.equal(kernelDeny.source.plugin, 'kernel');

  const composed = resolveUniversalDecisions([
    { plugin: 'a', decision: { kind: 'modify', target: 'chat.params', patch: { temperature: 0.1 } } },
    { plugin: 'b', decision: { kind: 'modify', target: 'chat.params', patch: { max_tokens: 512 } } },
  ]);
  assert.deepEqual(composed.decision.patch, { temperature: 0.1, max_tokens: 512 });

  const conflict = resolveUniversalDecisions([
    { plugin: 'a', decision: { kind: 'modify', target: 'chat.params', patch: { max_tokens: 512 } } },
    { plugin: 'b', decision: { kind: 'modify', target: 'chat.params', patch: { max_tokens: 1024 } } },
  ]);
  assert.equal(conflict.decision.kind, 'deny');
  assert.equal(conflict.reasonCode, 'universal_decision_conflict');
});

test('Phase 7 observation routing is effect-only and fail-open for optional errors', async () => {
  const emitted = [];
  const observed = await routeObservationEvent(event('message.input', { host: 'claude', turn: { userText: 'hi' } }), {
    emit: (name, payload) => emitted.push({ name, payload }),
    pluginHost: { invokePhase: async () => ({ effects: [{ kind: 'telemetry', name: 'seen' }, { kind: 'state.write', key: 'x', value: 1 }] }) },
  });
  assert.equal(observed.liveDecisionChanged, false);
  assert.deepEqual(observed.primaryDecision, { kind: 'allow' });
  assert.deepEqual(observed.effects, [{ kind: 'telemetry', name: 'seen' }]);
  assert.equal(emitted[0].name, 'universal_hook.observation_routed');

  const errored = await routeObservationEvent(event('tool.execute.after', { host: 'claude', tool: { name: 'Bash', output: 'ok' } }), {
    emit: (name, payload) => emitted.push({ name, payload }),
    pluginHost: { invokePhase: async () => { throw new Error('optional failed'); } },
  });
  assert.equal(errored.primaryDecision.kind, 'allow');
  assert.equal(errored.liveDecisionChanged, false);
});

test('Phase 8 chat.params routing applies only validated host patches', async () => {
  const body = { model: 'claude-sonnet', messages: [{ role: 'user', content: 'hi' }], max_tokens: 128 };
  const changed = await routeChatParams(body, {
    host: 'anthropic',
    pluginHost: { invokePhase: async () => ({ decisions: [{ kind: 'modify', target: 'chat.params', patch: { max_tokens: 256 } }] }) },
  });
  assert.equal(changed.changed, true);
  assert.equal(changed.body.max_tokens, 256);
  assert.equal(changed.body.model, 'claude-sonnet');
  assert.deepEqual(changed.output.requestPatch, { max_tokens: 256 });

  const blocked = await routeChatParams(body, {
    host: 'anthropic',
    pluginHost: { invokePhase: async () => ({ decisions: [{ kind: 'modify', target: 'chat.params', patch: { model: 'other' } }] }) },
  });
  assert.equal(blocked.changed, false);
  assert.equal(blocked.output.blocked, true);
  assert.equal(validatePatch({ model: 'other' }).valid, false);
});

test('Phase 9 tool gate routing runs mandatory policies fail-closed before plugin allows', async () => {
  const result = await routeToolGate(toolEvent('claude'), {
    host: 'claude',
    mandatoryPolicies: [{ name: 'kernel-tool-policy', evaluate: () => ({ kind: 'deny', reason: 'dangerous shell', severity: 'critical' }) }],
    pluginHost: { invokePhase: async () => ({ results: [{ applied: true, plugin: 'optional', decision: { kind: 'allow' } }] }) },
  });
  assert.equal(result.resolution.decision.kind, 'deny');
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'deny');

  const failed = await runMandatoryPolicies(toolEvent('claude'), [{ name: 'broken-kernel', evaluate: () => { throw new Error('explode'); } }]);
  assert.equal(failed[0].decision.kind, 'deny');
  assert.equal(failed[0].decision.severity, 'critical');
});

test('Phase 10 stop.before policy wraps WORK_CHECKS as a kernel policy', async () => {
  const stopEvent = event('stop.before', {
    host: 'claude',
    source: { host: 'claude', adapter: 'pipeline_test', rawEventName: 'Stop' },
    turn: { assistantText: 'Done.' },
  });
  const decision = evaluateStopBefore(stopEvent, { evaluate: () => ({ reason: 'bare completion', code: 'bare_completion_marker' }) });
  assert.equal(decision.kind, 'deny');
  assert.equal(decision.machineCode, 'bare_completion_marker');
  assert.equal(stopBeforeKernelPolicy.trust, 'kernel');
  assert.deepEqual(stopBeforeKernelPolicy.phases, ['stop.before']);
  assert.equal(Array.isArray(WORK_CHECKS), true);
});

test('Phase 11 stream.text_block policy returns allow drop or rewrite decisions', async () => {
  const allow = evaluateStreamTextBlock(event('stream.text_block', { host: 'anthropic', stream: { text: 'Substantive evidence remains.' } }));
  assert.equal(allow.decision.kind, 'allow');

  const drop = await streamTextBlockPolicy.handler(event('stream.text_block', { host: 'anthropic', stream: { text: 'OK.' } }), {
    ctx: { priorUserWasDeny: true },
    slot: 'post-tool-pre-slop',
  });
  assert.equal(drop.kind, 'drop');
  assert.equal(drop.target, 'stream.block');
});

test('Phase 12 provider template documents repeatable host expansion', () => {
  const fixturePath = path.join(__dirname, '../fixtures/universal_hooks/provider_template.json');
  const template = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(template.expectedFailureUntilExplicit, true);
  assert.deepEqual(template.required, [
    'event extraction',
    'session identity',
    'tool/permission representation',
    'decision application path',
    'host capability map entry',
    'golden fixtures',
  ]);
  const doc = fs.readFileSync(path.join(__dirname, '../../../../doc/hme-universal-provider-template.md'), 'utf8');
  assert.match(doc, /unsupported/);
  assert.match(doc, /advisory/);
  assert.match(doc, /enforcement/);
});

test('Phase 13 universal migration modules stay loadable and focused for cleanup gates', () => {
  const files = [
    'opencode_host.js',
    'decision_resolver.js',
    'observation_routing.js',
    'chat_params_routing.js',
    'tool_gate_routing.js',
    'stop_before_policy.js',
    'stream_text_block_policy.js',
  ];
  for (const file of files) {
    const full = path.join(__dirname, '../../omo_bridge', file);
    assert.doesNotThrow(() => require(full));
    const lines = fs.readFileSync(full, 'utf8').trim().split('\n').length;
    assert.ok(lines <= 350, `${file} exceeds LOC ceiling`);
  }
});
