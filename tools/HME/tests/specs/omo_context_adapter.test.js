'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerOmoContext, consumeOmoContext, clearOmoContext } = require('../../omo_bridge/context_adapter');

test('OMO context adapter registers dedupes and consumes within budget', () => {
  clearOmoContext('s1');
  assert.equal(registerOmoContext('s1', { source: 'hme:test', id: 'a', content: 'hello', priority: 'high' }).registered, true);
  assert.equal(registerOmoContext('s1', { source: 'hme:test', id: 'a', content: 'hello', priority: 'high' }).registered, false);
  const out = consumeOmoContext('s1', 100);
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].content, 'hello');
});

test('OMO context adapter enforces byte budget', () => {
  clearOmoContext('s2');
  registerOmoContext('s2', { source: 'hme:test', id: 'big', content: 'abcdef' });
  const out = consumeOmoContext('s2', 3);
  assert.equal(out.entries.length, 0);
});
