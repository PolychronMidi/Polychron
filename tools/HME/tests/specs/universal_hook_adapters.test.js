const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { toUniversalAnthropicEvent } = require('../../omo_bridge/adapters/anthropic_inbound');
const { toUniversalClaudeEvent } = require('../../omo_bridge/adapters/claude_inbound');
const { toUniversalCodexEvent } = require('../../omo_bridge/adapters/codex_inbound');
const { toUniversalOpenAiEvent } = require('../../omo_bridge/adapters/openai_inbound');
const { toUniversalOpenCodeEvent } = require('../../omo_bridge/adapters/opencode_inbound');
const {
  CAPABILITY_MODES,
  HOSTS,
  HOST_CAPABILITIES,
  phaseCapabilities,
  supportsDecision,
  unsupportedDecision,
} = require('../../omo_bridge/host_capabilities');
const { translateAnthropicDecision } = require('../../omo_bridge/translators/anthropic_decision');
const { translateClaudeDecision } = require('../../omo_bridge/translators/claude_decision');
const { translateCodexDecision } = require('../../omo_bridge/translators/codex_decision');
const { translateOpenAiDecision } = require('../../omo_bridge/translators/openai_decision');
const { translateOpenCodeDecision } = require('../../omo_bridge/translators/opencode_decision');
const { UNIVERSAL_HOOK_ABI, SUPPORTED_PHASES, validateUniversalEvent } = require('../../omo_bridge/universal_event');
const { DECISION_KINDS, DECISION_TARGETS, validateUniversalDecision } = require('../../omo_bridge/universal_decision');

const FIXTURE_DIR = path.join(__dirname, '../fixtures/universal_hooks');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

const inbound = readFixture('inbound.json');
const outbound = readFixture('outbound.json');

const INBOUND_ADAPTERS = Object.freeze({
  anthropic: toUniversalAnthropicEvent,
  claude: toUniversalClaudeEvent,
  codex: toUniversalCodexEvent,
  openai: toUniversalOpenAiEvent,
  opencode: toUniversalOpenCodeEvent,
});

const DECISION_TRANSLATORS = Object.freeze({
  anthropic: translateAnthropicDecision,
  claude: translateClaudeDecision,
  codex: translateCodexDecision,
  openai: translateOpenAiDecision,
  opencode: translateOpenCodeDecision,
});

function names(items) {
  return items.map((item) => item.name).sort();
}

function hosts(items) {
  return [...new Set(items.map((item) => item.universal.source.host))].sort();
}

test('universal hook inbound fixtures cover every initial host family', () => {
  assert.deepEqual(hosts(inbound), ['anthropic', 'claude', 'codex', 'openai', 'opencode']);
  assert.deepEqual(names(inbound), [
    'anthropic-proxy-request',
    'anthropic-stream-text-block',
    'claude-pre-tool',
    'claude-stop',
    'codex-tool-lifecycle',
    'openai-tool-call',
    'opencode-permission-ask',
  ]);
});

test('universal hook inbound expected events are valid and deterministic', () => {
  for (const item of inbound) {
    assert.equal(item.universal.abi, UNIVERSAL_HOOK_ABI, item.name);
    assert.equal(typeof item.universal.phase, 'string', item.name);
    assert.equal(typeof item.universal.source.adapter, 'string', item.name);
    assert.equal(typeof item.universal.source.rawEventName, 'string', item.name);
    assert.match(item.universal.timestamp, /^2026-05-25T00:00:0\d\.000Z$/, item.name);
    assert.deepEqual(validateUniversalEvent(item.universal), { valid: true, errors: [] }, item.name);
  }
});

test('universal hook inbound adapter modules match golden fixtures', () => {
  for (const item of inbound) {
    const host = item.universal.source.host;
    const adapter = INBOUND_ADAPTERS[host];
    assert.equal(typeof adapter, 'function', item.name);
    const actual = adapter(item.native, { id: item.universal.id, timestamp: item.universal.timestamp });
    assert.deepEqual(actual, item.universal, item.name);
  }
});

test('universal hook inbound fixtures reject missing required event fields', () => {
  for (const item of inbound) {
    const withoutSource = { ...item.universal };
    delete withoutSource.source;
    assert.equal(validateUniversalEvent(withoutSource).valid, false, item.name);

    if (item.universal.phase === 'chat.params') {
      const withoutChat = { ...item.universal };
      delete withoutChat.chat;
      assert.ok(validateUniversalEvent(withoutChat).errors.includes('chat.params requires chat'), item.name);
    }

    if (item.universal.phase.startsWith('tool.execute.')) {
      const withoutTool = { ...item.universal };
      delete withoutTool.tool;
      assert.ok(validateUniversalEvent(withoutTool).errors.includes(`${item.universal.phase} requires tool`), item.name);
    }

    if (item.universal.phase === 'permission.ask') {
      const withoutPermissionOrTool = { ...item.universal };
      delete withoutPermissionOrTool.permission;
      delete withoutPermissionOrTool.tool;
      assert.ok(validateUniversalEvent(withoutPermissionOrTool).errors.includes('permission.ask requires permission or tool'), item.name);
    }

    if (item.universal.phase === 'stream.text_block') {
      const withoutText = { ...item.universal, stream: { ...item.universal.stream } };
      delete withoutText.stream.text;
      assert.ok(validateUniversalEvent(withoutText).errors.includes('stream.text_block requires stream.text'), item.name);
    }
  }
});

test('universal hook outbound fixtures cover initial decision translations', () => {
  assert.deepEqual(names(outbound), [
    'anthropic-drop-stream-block',
    'anthropic-modify-chat-params',
    'claude-deny-pre-tool',
    'codex-allow-pre-tool',
    'openai-rewrite-stream-text',
    'opencode-ask-permission-deny',
  ]);
  assert.deepEqual([...new Set(outbound.map((item) => item.universalDecision.kind))].sort(), [
    'allow',
    'ask_permission',
    'deny',
    'drop',
    'modify',
    'rewrite',
  ]);
});

test('universal hook outbound decisions and host outputs are valid fixture contracts', () => {
  for (const item of outbound) {
    assert.deepEqual(validateUniversalDecision(item.universalDecision), { valid: true, errors: [] }, item.name);
    assert.equal(typeof item.host, 'string', item.name);
    assert.equal(typeof item.phase, 'string', item.name);
    assert.equal(item.hostOutput && typeof item.hostOutput, 'object', item.name);
  }
});

test('universal hook outbound translator modules match golden fixtures', () => {
  for (const item of outbound) {
    const translator = DECISION_TRANSLATORS[item.host];
    assert.equal(typeof translator, 'function', item.name);
    const actual = translator(item.universalDecision, { phase: item.phase });
    assert.deepEqual(actual, item.hostOutput, item.name);
  }
});

test('universal hook host capabilities reject unsupported target decisions explicitly', () => {
  const decision = { kind: 'modify', target: 'chat.params', patch: { max_tokens: 1024 } };
  assert.equal(supportsDecision('claude', 'chat.params', decision), false);
  assert.deepEqual(unsupportedDecision('claude', 'chat.params', decision), {
    unsupported: true,
    host: 'claude',
    phase: 'chat.params',
    decisionKind: 'modify',
    target: 'chat.params',
    failClosed: false,
    reason: 'claude does not support modify for chat.params',
  });
  assert.deepEqual(translateClaudeDecision(decision, { phase: 'chat.params' }), unsupportedDecision('claude', 'chat.params', decision));
});

test('universal hook capability map enumerates every host and ABI phase', () => {
  assert.deepEqual(Object.keys(HOST_CAPABILITIES).sort(), [...HOSTS].sort());
  for (const host of HOSTS) {
    assert.deepEqual(Object.keys(HOST_CAPABILITIES[host]).sort(), [...SUPPORTED_PHASES].sort(), host);
    for (const phase of SUPPORTED_PHASES) {
      const capabilities = phaseCapabilities(host, phase);
      assert.ok(CAPABILITY_MODES.includes(capabilities.mode), `${host}:${phase}`);
      assert.equal(capabilities, HOST_CAPABILITIES[host][phase], `${host}:${phase}`);
      for (const [kind, support] of Object.entries(capabilities.decisions)) {
        assert.ok(DECISION_KINDS.includes(kind), `${host}:${phase}:${kind}`);
        if (Array.isArray(support)) {
          for (const target of support) assert.ok((DECISION_TARGETS[kind] || []).includes(target), `${host}:${phase}:${kind}:${target}`);
        } else {
          assert.equal(support, true, `${host}:${phase}:${kind}`);
        }
      }
    }
  }
});

test('universal hook capabilities separate unsupported advisory and enforcement phases', () => {
  assert.equal(phaseCapabilities('claude', 'chat.params').mode, 'unsupported');
  assert.equal(phaseCapabilities('openai', 'tool.execute.after').mode, 'advisory');
  assert.equal(phaseCapabilities('anthropic', 'chat.params').mode, 'enforcement');
  assert.equal(supportsDecision('openai', 'tool.execute.after', { kind: 'allow' }), true);
  assert.equal(supportsDecision('openai', 'tool.execute.after', { kind: 'deny', reason: 'late failure' }), false);
  assert.equal(supportsDecision('anthropic', 'chat.params', { kind: 'modify', target: 'chat.params', patch: {} }), true);
});

test('universal hook proxy capabilities support request mutation and stream text rewriting', () => {
  for (const host of ['anthropic', 'openai']) {
    assert.equal(supportsDecision(host, 'chat.params', { kind: 'modify', target: 'chat.params', patch: {} }), true, host);
    assert.equal(supportsDecision(host, 'stream.text_block', { kind: 'drop', target: 'stream.block' }), true, host);
    assert.equal(supportsDecision(host, 'stream.text_block', { kind: 'rewrite', target: 'stream.text', text: '' }), true, host);
  }
  for (const host of ['claude', 'codex']) {
    assert.equal(supportsDecision(host, 'chat.params', { kind: 'modify', target: 'chat.params', patch: {} }), false, host);
    assert.equal(supportsDecision(host, 'stream.text_block', { kind: 'rewrite', target: 'stream.text', text: '' }), false, host);
  }
});

test('universal hook opencode capabilities cover direct OpenCode-compatible phases', () => {
  for (const phase of ['chat.params', 'permission.ask', 'tool.execute.before', 'tool.execute.after']) {
    assert.notEqual(phaseCapabilities('opencode', phase).mode, 'unsupported', phase);
  }
  assert.equal(supportsDecision('opencode', 'permission.ask', { kind: 'ask_permission', prompt: 'Approve?' }), true);
  assert.equal(supportsDecision('opencode', 'tool.execute.before', { kind: 'modify', target: 'tool.input', patch: {} }), true);
  assert.equal(supportsDecision('opencode', 'stream.text_block', { kind: 'rewrite', target: 'stream.text', text: '' }), false);
});

test('universal hook unsupported safety-critical decisions fail closed', () => {
  assert.equal(unsupportedDecision('opencode', 'stop.before', { kind: 'deny', reason: 'must stop' }).failClosed, true);
  assert.equal(unsupportedDecision('claude', 'tool.execute.before', { kind: 'modify', target: 'tool.input', patch: {} }).failClosed, true);
  assert.equal(unsupportedDecision('claude', 'chat.params', { kind: 'modify', target: 'chat.params', patch: {} }).failClosed, false);
  assert.equal(unsupportedDecision('unknown', 'permission.ask', { kind: 'allow' }).failClosed, false);
});

test('universal hook fixtures stay small enough for golden roundtrip tests', () => {
  for (const file of ['inbound.json', 'outbound.json']) {
    const bytes = fs.statSync(path.join(FIXTURE_DIR, file)).size;
    assert.ok(bytes < 8192, `${file} is too large for a deterministic golden fixture`);
  }
});
