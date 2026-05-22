'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classifyFailure, policyFor, actionsFor } = require('../../proxy/omni_failure_policy');

test('429 -> rate_limit', () => {
  assert.equal(classifyFailure(429, { type: 'rate_limit_error' }), 'rate_limit');
});

test('502 stream_timeout -> stream_timeout', () => {
  assert.equal(classifyFailure(502, { type: 'stream_timeout' }), 'stream_timeout');
  assert.equal(classifyFailure(502, { code: 'STREAM_READINESS_TIMEOUT' }), 'stream_timeout');
});

test('SSE context-window message -> context_window', () => {
  assert.equal(classifyFailure(200, { message: 'input exceeds the context window' }), 'context_window');
});

test('400/401/403 with credential keywords -> credential_failure', () => {
  assert.equal(classifyFailure(401, { type: 'authentication_error', message: 'invalid x-api-key' }), 'credential_failure');
  assert.equal(classifyFailure(400, { type: 'invalid_request_error', message: 'No credentials for provider: anthropic' }), 'credential_failure');
  assert.equal(classifyFailure(403, { type: 'authentication_error', message: 'forbidden' }), 'credential_failure');
});

test('5xx -> upstream_5xx', () => {
  assert.equal(classifyFailure(503, { type: 'service_unavailable' }), 'upstream_5xx');
});

test('generic 4xx -> client_4xx', () => {
  assert.equal(classifyFailure(404, { type: 'not_found', message: 'no such model' }), 'client_4xx');
});

test('policyFor returns kind, description, actions', () => {
  const p = policyFor(429, { type: 'rate_limit_error' });
  assert.equal(p.kind, 'rate_limit');
  assert.match(p.description, /quota/);
  assert.ok(p.actions.includes('refresh_oauth_if_oauth'));
});

test('actionsFor returns a fresh array (cannot mutate the policy table)', () => {
  const a = actionsFor(429, { type: 'rate_limit_error' });
  a.push('mutated');
  const b = actionsFor(429, { type: 'rate_limit_error' });
  assert.equal(b.includes('mutated'), false);
});
