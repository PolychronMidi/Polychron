'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const omniroute = require('../../proxy/omniroute_client');

test('qualifyModel attaches provider prefix when missing', () => {
  assert.equal(omniroute.qualifyModel('codex', 'gpt-5.5-xhigh'), 'cx/gpt-5.5-xhigh');
  assert.equal(omniroute.qualifyModel('anthropic', 'claude-opus-4-7', {}), 'claude/claude-opus-4-7');
});

test('qualifyModel respects already-qualified ids', () => {
  assert.equal(omniroute.qualifyModel('codex', 'cx/gpt-5.5'), 'cx/gpt-5.5');
});

test('isCodexTarget identifies codex providers', () => {
  assert.equal(omniroute.isCodexTarget('codex'), true);
  assert.equal(omniroute.isCodexTarget('anthropic'), false);
});

test('targetFormatFor returns openai-responses for codex, provider-default otherwise', () => {
  assert.equal(omniroute.targetFormatFor('codex'), 'openai-responses');
  assert.equal(omniroute.targetFormatFor('anthropic'), 'provider-default');
});

test('isTransientStreamTimeout returns true on 502 with stream_timeout type', () => {
  assert.equal(omniroute.isTransientStreamTimeout({ status: 502, errInfo: { type: 'stream_timeout' } }), true);
});

test('isTransientStreamTimeout matches STREAM_READINESS_TIMEOUT code', () => {
  assert.equal(omniroute.isTransientStreamTimeout({ status: 502, errInfo: { code: 'STREAM_READINESS_TIMEOUT' } }), true);
});

test('isTransientStreamTimeout matches via raw body when errInfo is missing', () => {
  const body = Buffer.from('{"error":{"type":"stream_timeout"}}');
  assert.equal(omniroute.isTransientStreamTimeout({ status: 502, body }), true);
});

test('isTransientStreamTimeout rejects non-502 statuses', () => {
  assert.equal(omniroute.isTransientStreamTimeout({ status: 429, errInfo: { type: 'stream_timeout' } }), false);
});

test('isTransientStreamTimeout rejects unrelated 502 failures', () => {
  assert.equal(omniroute.isTransientStreamTimeout({ status: 502, errInfo: { type: 'api_error' }, body: '{"error":{"type":"api_error"}}' }), false);
});

test('firstLegacyChatCandidate skips codex entries', () => {
  const chain = [
    { id: 'gpt-5.5', provider: 'codex' },
    { id: 'opus', provider: 'anthropic' },
  ];
  const out = omniroute.firstLegacyChatCandidate(chain);
  assert.equal(out.model.id, 'opus');
  assert.equal(out.idx, 1);
});
