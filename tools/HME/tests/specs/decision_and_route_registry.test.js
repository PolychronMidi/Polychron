'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const Decision = require('../../event_kernel/decision');
const Render = require('../../event_kernel/decision_renderer');
const routes = require('../../event_kernel/route_registry');
const hostEntry = require('../../event_kernel/host_hook_entry');
const hostCommon = require('../../event_kernel/host_adapter_common');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HOOKS_ROOT = path.resolve(__dirname, '..', '..', 'hooks');

test('Decision algebra preserves host-neutral shapes', () => {
  assert.deepEqual(Decision.TYPES, Object.freeze({ ALLOW: 'allow', DENY: 'deny', INSTRUCT: 'instruct', REWRITE: 'rewrite', ERROR: 'error' }));
  assert.deepEqual(Decision.allow('ok'), { decision: 'allow', message: 'ok' });
  assert.deepEqual(Decision.deny('no'), { decision: 'deny', reason: 'no' });
  assert.deepEqual(Decision.instruct('look'), { decision: 'instruct', message: 'look' });
  assert.deepEqual(Decision.rewrite({ command: 'pwd' }, 'rewritten'), {
    decision: 'rewrite', updatedInput: { command: 'pwd' }, message: 'rewritten',
  });
  assert.equal(Decision.kindOf(Decision.rewrite()), 'rewrite');
  assert.equal(Decision.isAllow(Decision.allow()), true);
  assert.equal(Decision.isError(Decision.error('broken')), true);
  assert.deepEqual(Decision.deny('no', { source: 'test' }), { decision: 'deny', reason: 'no', meta: { source: 'test' } });
});

test('Decision.combineFirstDeny keeps first deny and aggregates instruct/rewrite/error', () => {
  const r = Decision.combineFirstDeny([
    Decision.instruct('a'),
    Decision.deny('first'),
    Decision.deny('second'),
    Decision.rewrite({ x: 1 }, 'rw'),
    Decision.error('broken'),
  ]);
  assert.equal(r.firstDeny.reason, 'first');
  assert.deepEqual(r.instructs.map((x) => x.message), ['a']);
  assert.deepEqual(r.rewrites.map((x) => x.message), ['rw']);
  assert.deepEqual(r.errors.map((x) => x.message), ['broken']);
});

test('decision renderer owns hookSpecificOutput for policy denies, rewrites, and instructs', () => {
  const denied = JSON.parse(Render.renderPolicyAggregate({ firstDeny: Decision.deny('no') }, { eventName: 'PreToolUse' }));
  assert.deepEqual(denied.hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'no',
  });
  const rewritten = JSON.parse(Render.renderPolicyAggregate({
    firstDeny: null,
    rewrites: [Decision.rewrite({ command: 'pwd' }, 'rw')],
    instructs: [Decision.instruct('note')],
  }, { eventName: 'PreToolUse', toolInput: { command: 'pwd' } }));
  assert.deepEqual(rewritten.hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: { command: 'pwd' },
    additionalContext: 'note',
  });
  assert.doesNotMatch(JSON.stringify(rewritten), /rw/);
  const instructed = JSON.parse(Render.renderPolicyAggregate({
    firstDeny: null,
    rewrites: [],
    instructs: [Decision.instruct('a'), Decision.instruct('b')],
  }, { eventName: 'PostToolUse' }));
  assert.deepEqual(instructed.hookSpecificOutput, { hookEventName: 'PostToolUse', additionalContext: 'a\n\nb' });
});

test('decision renderer renders PermissionRequest output with PermissionRequest hookEventName', () => {
  const out = JSON.parse(Render.renderPolicyAggregate({ firstDeny: Decision.deny('no') }, { eventName: 'PermissionRequest' }));
  assert.deepEqual(out.hookSpecificOutput, {
    hookEventName: 'PermissionRequest',
    permissionDecision: 'deny',
    permissionDecisionReason: 'no',
  });
});

test('policy-path modules do not construct host hook JSON directly', () => {
  const rels = [
    'tools/HME/event_kernel/dispatcher.js',
    'tools/HME/proxy/pre_write_check.js',
    ...fs.readdirSync(path.join(REPO_ROOT, 'tools/HME/policies/builtin'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => `tools/HME/policies/builtin/${f}`),
  ];
  for (const rel of rels) {
    assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), /hookSpecificOutput/, rel);
  }
});

test('host hook entry bypasses only peer lifecycle events and still gates peer tools', () => {
  const peerEnv = { HME_TEAM_PEER: '1' };
  assert.equal(hostEntry.shouldBypassPeerLifecycle('UserPromptSubmit', peerEnv), true);
  assert.equal(hostEntry.shouldBypassPeerLifecycle('SessionStart', peerEnv), true);
  assert.equal(hostEntry.shouldBypassPeerLifecycle('PreToolUse', peerEnv), false);
  assert.equal(hostEntry.shouldBypassPeerLifecycle('PostToolUse', peerEnv), false);
  assert.match(hostEntry.failSafeStdout('PreToolUse', 'too large'), /permissionDecision":"deny/);
  assert.equal(hostEntry.failSafeStdout('PostToolUse', 'too large'), '');
});

test('host adapter common bounds stdin/proxy response and denies oversize gating input', () => {
  assert.ok(hostCommon.MAX_STDIN_BYTES > 0);
  assert.ok(hostCommon.MAX_PROXY_RESPONSE_BYTES > 0);
  assert.ok(hostCommon.PROXY_ATTEMPT_TIMEOUT_MS <= 15_000);
  const denied = hostCommon._stdinTooLargeResult('PermissionRequest', new Error('oversize'));
  assert.match(denied.stdout, /permissionDecision":"deny/);
  assert.equal(hostCommon._stdinTooLargeResult('PostToolUse', new Error('oversize')).stdout, '');
});

test('route registry exposes executable dispatcher contract', () => {
  assert.equal(routes.policyContext('PermissionRequest'), 'PreToolUse');
  assert.equal(routes.strictMode('SessionStart'), 'strict-only');
  assert.ok(routes.isObservationEvent('TextComplete'));
  const pre = routes.shellByTool('PreToolUse');
  assert.deepEqual(pre.Bash, ['pretooluse/pretooluse_bash.sh']);
  const post = routes.shellByTool('PostToolUse');
  assert.deepEqual(post.Bash, ['posttooluse/posttooluse_bash.sh', 'posttooluse/posttooluse_pipeline_kb.sh']);
});

test('route registry script paths point at real hook files', () => {
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact']) {
    for (const rel of routes.lifecycleScripts(event)) {
      assert.ok(require('node:fs').existsSync(path.join(HOOKS_ROOT, rel)), `${event} script missing: ${rel}`);
    }
  }
  for (const event of ['PreToolUse', 'PostToolUse']) {
    for (const scripts of Object.values(routes.shellByTool(event))) {
      for (const rel of scripts) assert.ok(require('node:fs').existsSync(path.join(HOOKS_ROOT, rel)), `${event} script missing: ${rel}`);
    }
  }
});
