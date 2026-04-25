'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../policies/registry');

test('registry: register validates the policy contract', () => {
  // Use a fresh-name policy so it doesn't collide with builtins.
  const p = {
    name: 'test-fixture-validate-' + Date.now(),
    description: 'unit test fixture',
    category: 'test',
    defaultEnabled: false,
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

test('registry: register rejects duplicate names', () => {
  const name = 'test-dup-' + Date.now();
  const p = {
    name, description: 'x', category: 'test', defaultEnabled: false,
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
