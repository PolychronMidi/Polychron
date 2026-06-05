'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('../../policies/registry');

test('registry: register validates the policy contract', () => {
  // Use a fresh-name policy so it doesn't collide with builtins.
  const p = {
    name: 'test-fixture-validate-' + Date.now(),
    description: 'unit test fixture',
    category: 'test',
    defaultEnabled: false,
    decisionClass: 'mixed',
    match: { events: ['PreToolUse'], tools: ['Bash'] },
    fn: () => registry.allow(),
  };
  assert.doesNotThrow(() => registry.register(p));
});

test('registry: register rejects missing fn', () => {
  assert.throws(() => registry.register({
    name: 'bad-' + Date.now(),
    description: 'x',
    category: 'test',
    defaultEnabled: true,
    match: { events: ['Stop'] },
    // no fn
  }), /missing 'fn/);
});

test('registry: register rejects empty events', () => {
  assert.throws(() => registry.register({
    name: 'bad-events-' + Date.now(),
    description: 'x',
    category: 'test',
    defaultEnabled: true,
    match: { events: [] },
    fn: () => {},
  }), /match\.events/);
});

test('registry: register rejects missing decisionClass', () => {
  assert.throws(() => registry.register({
    name: 'bad-decision-class-' + Date.now(),
    description: 'x',
    category: 'test',
    defaultEnabled: true,
    match: { events: ['Stop'] },
    fn: () => registry.allow(),
  }), /decisionClass as block\|rewrite\|mixed/);
});

test('loadCustom rejects custom policies without decisionClass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-custom-policy-'));
  try {
    const file = path.join(dir, 'missing-decision-class.js');
    fs.writeFileSync(file, `module.exports = { name:'custom-missing-decision-class-${Date.now()}', description:'x', category:'test', defaultEnabled:true, match:{events:['Stop']}, fn:(ctx)=>ctx.allow() };\n`);
    assert.throws(() => registry.loadCustom(file), /decisionClass as block\|rewrite\|mixed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadCustom rejects custom policy whose decisionClass contradicts source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-custom-drift-'));
  try {
    const file = path.join(dir, 'block-named-rewriter.js');
    fs.writeFileSync(file, `module.exports = { name:'custom-block-but-rewrites-${Date.now()}', description:'x', category:'test', defaultEnabled:false, decisionClass:'block', match:{events:['PreToolUse'],tools:['Write']}, fn:(ctx)=>ctx.rewrite({}, 'x') };\n`);
    assert.throws(() => registry.loadCustom(file), /declares decisionClass 'block' but only rewrites/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('policyDecisionClass returns declared class or mixed (no name inference)', () => {
  assert.strictEqual(registry.policyDecisionClass({ name: 'block-foo', decisionClass: 'rewrite' }), 'rewrite');
  assert.strictEqual(registry.policyDecisionClass({ name: 'block-foo' }), 'mixed');
  assert.strictEqual(registry.policyDecisionClass({ name: 'rewrite-foo' }), 'mixed');
  assert.strictEqual(registry.policyDecisionClass({}), 'mixed');
});

test('registry: register rejects duplicate names', () => {
  const name = 'test-dup-' + Date.now();
  const p = {
    name, description: 'x', category: 'test', defaultEnabled: false, decisionClass: 'mixed',
    match: { events: ['Stop'] }, fn: () => {},
  };
  registry.register(p);
  assert.throws(() => registry.register(p), /collision/);
});

test('matching: filters by event', () => {
  registry.loadBuiltins();
  const stop = registry.matchingFor('Stop', '', null);
  const pre = registry.matchingFor('PreToolUse', 'Bash', null);
  // Both event types should have at least one policy after builtins load.
  assert.ok(stop.length >= 1, 'expected at least one Stop policy');
  assert.ok(pre.length >= 1, 'expected at least one PreToolUse Bash policy');
  // Cross-check: a Stop-event policy should not appear in a PreToolUse query.
  const stopName = stop[0].name;
  const preNames = pre.map((p) => p.name);
  assert.ok(!preNames.includes(stopName), `${stopName} (Stop) leaked into PreToolUse results`);
});

test('matching: tool filter applies', () => {
  registry.loadBuiltins();
  const bash = registry.matchingFor('PreToolUse', 'Bash', null);
  const write = registry.matchingFor('PreToolUse', 'Write', null);
  // The block-curl-pipe-sh policy should be in Bash but not Write.
  const bashNames = bash.map((p) => p.name);
  const writeNames = write.map((p) => p.name);
  assert.ok(bashNames.includes('block-curl-pipe-sh'));
  assert.ok(!writeNames.includes('block-curl-pipe-sh'));
});

test('policyDecisionClass matches decision verb and drives genome defaults', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = registry.BUILTIN_DIR;
  const mism = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js') && !n.startsWith('_'))) {
    const full = path.join(dir, f);
    const src = fs.readFileSync(full, 'utf8');
    const policy = require(full);
    const cls = registry.policyDecisionClass(policy);
    const canDeny = /ctx\.deny\b/.test(src);
    const canRewrite = /ctx\.rewrite\b/.test(src);
    if (cls === 'block' && canRewrite && !canDeny) mism.push(`${policy.name}: class block but only rewrites`);
    if (cls === 'rewrite' && canDeny && !canRewrite) mism.push(`${policy.name}: class rewrite but only denies`);
    const g = registry.genomeInput(policy);
    if (cls === 'rewrite') {
      assert.strictEqual(g.fail_open_or_closed, 'open', `${policy.name} rewrite genome fail-open`);
      assert.strictEqual(g.telemetry_only, true, `${policy.name} rewrite genome telemetry`);
    }
  }
  assert.deepStrictEqual(mism, [], `policy decision-class drift: ${mism.join('; ')}`);
});

test('runChain: first deny wins; chain continues for side effects', async () => {
  const calls = [];
  const policies = [
    { name: 'a', defaultEnabled: true, match: { events: ['Stop'] },
      fn: (ctx) => { calls.push('a'); return ctx.deny('first'); } },
    { name: 'b', defaultEnabled: true, match: { events: ['Stop'] },
      fn: (ctx) => { calls.push('b'); return ctx.deny('second'); } },
    { name: 'c', defaultEnabled: true, match: { events: ['Stop'] },
      fn: (ctx) => { calls.push('c'); return ctx.allow(); } },
  ];
  const ctx = { deny: registry.deny, instruct: registry.instruct, allow: registry.allow };
  const { firstDeny, errors } = await registry.runChain(policies, ctx);
  assert.deepStrictEqual(calls, ['a', 'b', 'c'], 'all policies must execute');
  assert.strictEqual(firstDeny.reason, 'first', 'only the first deny is captured');
  assert.strictEqual(errors.length, 0);
});

test('runChain: thrown policy is logged but does not break the chain', async () => {
  const policies = [
    { name: 'broken', defaultEnabled: true, match: { events: ['Stop'] },
      fn: () => { throw new Error('intentional'); } },
    { name: 'after', defaultEnabled: true, match: { events: ['Stop'] },
      fn: (ctx) => ctx.allow() },
  ];
  const ctx = { deny: registry.deny, instruct: registry.instruct, allow: registry.allow };
  const { firstDeny, errors } = await registry.runChain(policies, ctx);
  assert.strictEqual(firstDeny, null);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].policy, 'broken');
  assert.match(errors[0].error, /intentional/);
});
