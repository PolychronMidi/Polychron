'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _stripSlop, slopStripRewrite } = require('../../proxy/sse_rewriters');

test('slop caveman compression deletes requested glue words case-insensitively', () => {
  const result = _stripSlop("I'm the one; I am now too ready; it has the fix; I will ship now.");
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'One; Ready; it fix; Ship.');
});

test('slop rewriter applies caveman compression to text blocks', () => {
  const ctx = new Map([['priorUserWasDeny', true]]);
  assert.equal(slopStripRewrite('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, ctx), null);
  assert.equal(slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will now fix the thing.' } }, ctx), null);
  const out = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 0 }, ctx);
  assert.equal(out.events[1][1].delta.type, 'text_delta');
  assert.equal(out.events[1][1].delta.text, 'Fix thing.');
});

test('slop rewriter applies caveman compression to thinking blocks', () => {
  const ctx = new Map([['priorUserWasDeny', true]]);
  assert.equal(slopStripRewrite('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } }, ctx), null);
  assert.equal(slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'I am now checking the path.' } }, ctx), null);
  const out = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 1 }, ctx);
  assert.equal(out.events[1][1].delta.type, 'thinking_delta');
  assert.equal(out.events[1][1].delta.thinking, 'Checking path.');
});
