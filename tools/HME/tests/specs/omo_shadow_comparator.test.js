'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  ADAPTER_ERROR_EVENT,
  SHADOW_MATCH_EVENT,
  SHADOW_MISMATCH_EVENT,
  compareProxyRequestShadow,
  compareShadowDecisions,
  pluginResultsToUniversalDecision,
  runShadowComparison,
} = require('../../omo_bridge/shadow_comparator');

function event() {
  return {
    abi: 'hme-opencode-hook/v1',
    id: 'fixture-event',
    phase: 'tool.execute.before',
    source: { host: 'claude', adapter: 'claude_inbound', rawEventName: 'PreToolUse' },
    session: { id: 'session-1' },
    tool: { name: 'Bash', input: { command: 'echo secret text' } },
    context: { lifecycle: { event: 'PreToolUse' } },
  };
}

test('shadow comparator emits compact match telemetry', () => {
  const emitted = [];
  const result = compareShadowDecisions({
    universalEvent: event(),
    nativeDecision: { kind: 'deny', reason: 'blocked', machineCode: 'dangerous_shell' },
    universalDecision: { kind: 'deny', reason: 'blocked elsewhere', machineCode: 'dangerous_shell' },
    telemetry: (payload) => emitted.push(payload),
  });

  assert.equal(result.event, SHADOW_MATCH_EVENT);
  assert.equal(result.host, 'claude');
  assert.equal(result.phase, 'tool.execute.before');
  assert.equal(result.adapter, 'claude_inbound');
  assert.equal(result.native_decision_kind, 'deny');
  assert.equal(result.universal_decision_kind, 'deny');
  assert.equal(result.native_reason_code, 'dangerous_shell');
  assert.equal(result.universal_reason_code, 'dangerous_shell');
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], result);
  assert.equal('payload' in result, false);
});

test('shadow comparator emits mismatch telemetry with reason codes', () => {
  const result = compareShadowDecisions({
    universalEvent: event(),
    nativeDecision: { kind: 'allow' },
    universalDecision: { kind: 'deny', reason: 'blocked', machineCode: 'omo_hook_blocked' },
  });

  assert.equal(result.event, SHADOW_MISMATCH_EVENT);
  assert.equal(result.matched, false);
  assert.equal(result.native_decision_kind, 'allow');
  assert.equal(result.universal_decision_kind, 'deny');
  assert.equal(result.universal_reason_code, 'omo_hook_blocked');
});

test('shadow comparator reports adapter errors without throwing', () => {
  const emitted = [];
  const result = runShadowComparison({
    enabled: true,
    host: 'anthropic',
    phase: 'chat.params',
    adapter: 'bad_adapter',
    nativeEvent: { body: { messages: [{ content: 'private payload' }] } },
    adapt() { throw new TypeError('adapter exploded with private payload'); },
    telemetry: (payload) => emitted.push(payload),
  });

  assert.equal(result.event, ADAPTER_ERROR_EVENT);
  assert.equal(result.host, 'anthropic');
  assert.equal(result.phase, 'chat.params');
  assert.equal(result.adapter, 'bad_adapter');
  assert.equal(result.error_type, 'TypeError');
  assert.equal('nativeEvent' in result, false);
  assert.equal('payload' in result, false);
  assert.equal(emitted.length, 1);
});

test('shadow comparator disabled path is silent', () => {
  const emitted = [];
  const result = runShadowComparison({
    enabled: false,
    nativeEvent: {},
    adapt() { throw new Error('should not run'); },
    telemetry: (payload) => emitted.push(payload),
  });

  assert.deepEqual(result, { skipped: true, reason: 'disabled' });
  assert.deepEqual(emitted, []);
});

test('proxy request shadow comparison is read-only and summarized', () => {
  const payload = {
    model: 'claude-sonnet',
    messages: [{ role: 'user', content: 'do not log this prompt' }],
    max_tokens: 128,
  };
  const before = JSON.stringify(payload);
  const result = compareProxyRequestShadow({
    payload,
    session: 'session-2',
    nativeDecision: { kind: 'allow' },
    universalDecision: { kind: 'allow' },
  });

  assert.equal(JSON.stringify(payload), before);
  assert.equal(result.event, SHADOW_MATCH_EVENT);
  assert.equal(result.host, 'anthropic');
  assert.equal(result.phase, 'chat.params');
  assert.equal(result.adapter, 'anthropic_inbound');
  assert.equal(result.message_count, 1);
  assert.equal('messages' in result, false);
});

test('plugin result summaries become universal decisions', () => {
  assert.deepEqual(pluginResultsToUniversalDecision([{ result: 'noop' }]), { kind: 'allow' });
  assert.deepEqual(
    pluginResultsToUniversalDecision([{ result: 'blocked', validation: { reason: 'mutation blocked' } }]),
    { kind: 'deny', reason: 'mutation blocked', machineCode: 'omo_hook_blocked' },
  );
  assert.deepEqual(
    pluginResultsToUniversalDecision([{ result: 'error', error: 'boom' }]),
    { kind: 'defer', reason: 'OMO hook error', machineCode: 'omo_hook_error' },
  );
});
