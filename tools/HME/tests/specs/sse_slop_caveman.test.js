'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _stripSlop, slopStripRewrite } = require('../../proxy/sse_slop_rewriter');

test('slop caveman compression deletes requested glue words case-insensitively', () => {
  const result = _stripSlop("I'm the one; I am now too ready; it has the fix; I will ship now.");
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'One; ready; it fix; ship.');
});

test('slop abbreviations are case-insensitive and preserve punctuation', () => {
  const result = _stripSlop('Acknowledged. WITHOUT delay, move into tests and to prod.');
  assert.ok(result.hits.includes('abbreviations'));
  assert.equal(result.out, 'K. W/o delay, move 2 tests & - prod.');
});

test('slop caveman contractions are ordered before bare pronouns', () => {
  const result = _stripSlop("You're ready and we’re done; you'll see we’ll pass.");
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'Ready & done; see pass.');
  assert.doesNotMatch(result.out, /['’](re|ll|m)\b/);
});

test('slop cleanup collapses punctuation left by caveman deletions', () => {
  const result = _stripSlop('RIGHT. Okay? AGREED! A plan remains.');
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'Plan remains.');
});

test('slop rewriter applies full slop stripping to text blocks without deny gate', () => {
  const ctx = new Map();
  assert.equal(slopStripRewrite('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, ctx), null);
  assert.equal(slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Acknowledged. I will now fix the thing and test.' } }, ctx), null);
  const out = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 0 }, ctx);
  assert.equal(out.events[1][1].delta.type, 'text_delta');
  assert.equal(out.events[1][1].delta.text, 'K. Fix thing & test.');
});

test('stop-hook bare ack treats slop-compressed K as strip-worthy after deny', () => {
  const { _isBareAck } = require('../../proxy/sse_stop_hook_rewriters');
  assert.equal(_isBareAck('K.'), true);
});

test('slop rewriter applies caveman compression to thinking blocks without deny gate', () => {
  const ctx = new Map();
  assert.equal(slopStripRewrite('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } }, ctx), null);
  assert.equal(slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'I am now checking the path.' } }, ctx), null);
  const out = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 1 }, ctx);
  assert.equal(out.events[1][1].delta.type, 'thinking_delta');
  assert.equal(out.events[1][1].delta.thinking, 'Checking path.');
});
