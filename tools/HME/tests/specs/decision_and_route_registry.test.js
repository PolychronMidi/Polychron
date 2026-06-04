'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const fs = require('node:fs');
const Decision = require('../../event_kernel/decision');
const Render = require('../../event_kernel/decision_renderer');
const routes = require('../../event_kernel/route_registry');

const HOOKS_ROOT = path.resolve(__dirname, '..', '..', 'hooks');

test('Decision algebra preserves host-neutral shapes', () => {
  assert.deepEqual(Decision.allow('ok'), { decision: 'allow', message: 'ok' });
  assert.deepEqual(Decision.deny('no'), { decision: 'deny', reason: 'no' });
  assert.deepEqual(Decision.instruct('look'), { decision: 'instruct', message: 'look' });
  assert.deepEqual(Decision.rewrite({ command: 'pwd' }, 'rewritten'), {
    decision: 'rewrite', updatedInput: { command: 'pwd' }, message: 'rewritten',
  });
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
