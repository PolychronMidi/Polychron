'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getOmoSessionSnapshot } = require('../../omo_bridge/session_adapter');

test('OMO session adapter is read-only disabled by default', async () => {
  const out = await getOmoSessionSnapshot('s1');
  assert.equal(out.source, 'disabled');
  assert.deepEqual(out.snapshot.todos, []);
});

test('OMO session adapter reads snapshot when available', async () => {
  const out = await getOmoSessionSnapshot('s1', { omo: { session: { snapshot: async () => ({ todos: [{ id: 1 }], tasks: [{ id: 't' }] }) } } });
  assert.equal(out.source, 'omo');
  assert.equal(out.snapshot.todos.length, 1);
  assert.equal(out.snapshot.tasks.length, 1);
});

test('OMO session adapter reads OpenCode client-shim session APIs', async () => {
  const client = {
    session: {
      async get() { return { data: { agents: ['hme'] } }; },
      async messages() { return { data: [{ info: { id: 'm1' } }] }; },
      async todo() { return { data: [{ id: 'td1' }] }; },
    },
  };
  const out = await getOmoSessionSnapshot('s1', { client });
  assert.equal(out.source, 'client');
  assert.equal(out.snapshot.agents.length, 1);
  assert.equal(out.snapshot.messages.length, 1);
  assert.equal(out.snapshot.todos.length, 1);
});
