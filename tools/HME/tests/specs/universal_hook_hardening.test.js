const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createOpenCodeCompatPlugin } = require('../../omo_bridge/opencode_compat');
const { createUniversalOpenCodeHost } = require('../../omo_bridge/opencode_host');
const { compareProxyRequestShadow } = require('../../omo_bridge/shadow_comparator');
const { HOST_CAPABILITIES, HOSTS, phaseCapabilities, supportsDecision } = require('../../omo_bridge/host_capabilities');

function event(phase, extra = {}) {
  return {
    abi: 'hme-opencode-hook/v1',
    id: `${phase}-hardening`,
    timestamp: '2026-05-25T00:00:00.000Z',
    source: { host: 'opencode', adapter: 'hardening_test', rawEventName: phase },
    phase,
    session: { id: 's1', agent: 'opencode', provider: 'opencode' },
    context: {},
    ...extra,
  };
}

function permissionEvent() {
  return event('permission.ask', { tool: { name: 'Bash', input: { command: 'git status --short' } }, permission: { action: 'execute', target: 'Bash', risk: 'low' } });
}

test('OpenCode-shaped hooks adapt output mutation into universal decisions', async () => {
  const typeSurface = path.join(__dirname, '../../../../node_modules/@opencode-ai/plugin/dist/index.d.ts');
  assert.match(fs.readFileSync(typeSurface, 'utf8'), /"chat\.params"/);
  const plugin = createOpenCodeCompatPlugin({
    async 'chat.params'(_input, output) { output.maxOutputTokens = 321; },
    async 'permission.ask'(_input, output) { output.status = 'deny'; },
    async 'tool.execute.before'(_input, output) { output.args.command = 'npm test'; },
  }, { name: 'opencode-shaped' });
  const host = createUniversalOpenCodeHost({ host: 'opencode', plugins: [plugin] });

  const chat = await host.invokePhase(event('chat.params', { chat: { params: { model: 'test', max_tokens: 128 }, messages: [] } }));
  assert.deepEqual(chat.primaryDecision, { kind: 'modify', target: 'chat.params', patch: { max_tokens: 321 }, reason: 'OpenCode chat.params mutation' });

  const permission = await host.invokePhase(permissionEvent());
  assert.equal(permission.primaryDecision.kind, 'deny');
  assert.equal(permission.primaryDecision.machineCode, 'opencode_permission_denied');

  const tool = await host.invokePhase(event('tool.execute.before', { tool: { id: 'call1', name: 'Bash', input: { command: 'echo ok' } } }));
  assert.deepEqual(tool.primaryDecision, { kind: 'modify', target: 'tool.input', patch: { command: 'npm test' }, reason: 'OpenCode tool args mutation' });
});

test('external plugins are live-sandboxed unless explicitly trusted', async () => {
  const plugin = { name: 'external-deny', trust: 'external', phases: ['permission.ask'], capabilities: { decisions: ['deny'] }, handler: () => ({ kind: 'deny', reason: 'third party deny' }) };
  const sandboxed = await createUniversalOpenCodeHost({ host: 'opencode', plugins: [plugin] }).invokePhase(permissionEvent());
  assert.equal(sandboxed.results[0].status, 'sandbox_violation');
  assert.equal(sandboxed.primaryDecision.kind, 'allow');

  const trusted = await createUniversalOpenCodeHost({ host: 'opencode', allowExternalLive: true, plugins: [plugin] }).invokePhase(permissionEvent());
  assert.equal(trusted.results[0].status, 'applied');
  assert.equal(trusted.primaryDecision.kind, 'deny');
});

test('plugin latency is measured per plugin and per phase', async () => {
  const host = createUniversalOpenCodeHost({ host: 'opencode', plugins: [{ name: 'latency', phases: ['permission.ask'], capabilities: { decisions: ['allow'] }, handler: () => ({ kind: 'allow' }) }] });
  const result = await host.invokePhase(permissionEvent());
  assert.equal(typeof result.durationMs, 'number');
  assert.equal(typeof result.results[0].durationMs, 'number');
  assert.ok(result.durationMs >= result.results[0].durationMs);
});

test('shadow telemetry validation remains compact and payload-free', () => {
  const emitted = [];
  const result = compareProxyRequestShadow({
    payload: { model: 'claude-sonnet', messages: [{ role: 'user', content: 'private prompt' }] },
    session: 'live-shadow-fixture',
    nativeDecision: { kind: 'allow' },
    universalDecision: { kind: 'deny', reason: 'blocked', machineCode: 'fixture_block' },
    telemetry: (payload) => emitted.push(payload),
  });
  assert.equal(result.event, 'universal_hook_shadow_mismatch');
  assert.equal(result.message_count, 1);
  for (const bulky of ['payload', 'messages', 'nativeEvent']) assert.equal(Object.hasOwn(result, bulky), false);
  assert.deepEqual(emitted, [result]);
});

test('host capability matrix semantics stay explicit for production rollout', () => {
  assert.deepEqual(Object.keys(HOST_CAPABILITIES).sort(), [...HOSTS].sort());
  for (const host of ['claude', 'codex']) {
    assert.equal(phaseCapabilities(host, 'stop.before').mode, 'enforcement');
    assert.equal(supportsDecision(host, 'stop.before', { kind: 'deny', reason: 'stop' }), true);
    assert.equal(phaseCapabilities(host, 'chat.params').mode, 'unsupported');
  }
  for (const host of ['anthropic', 'openai']) {
    assert.equal(phaseCapabilities(host, 'chat.params').mode, 'enforcement');
    assert.equal(supportsDecision(host, 'stream.text_block', { kind: 'rewrite', target: 'stream.text', text: '' }), true);
  }
  assert.equal(phaseCapabilities('opencode', 'stream.text_block').mode, 'unsupported');
});
