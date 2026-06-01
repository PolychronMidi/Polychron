'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classifyFailure, policyFor, actionsFor } = require('../../proxy/contexts/failure_policy/omni_failure_policy');

test('429 -> rate_limit', () => {
  assert.equal(classifyFailure(429, { type: 'rate_limit_error' }), 'rate_limit');
});

test('502 stream_timeout -> stream_timeout', () => {
  assert.equal(classifyFailure(502, { type: 'stream_timeout' }), 'stream_timeout');
  assert.equal(classifyFailure(502, { code: 'STREAM_READINESS_TIMEOUT' }), 'stream_timeout');
});

test('OmniRoute 200 api_error terminated -> stream_timeout', () => {
  assert.equal(classifyFailure(200, { type: 'api_error', message: 'terminated' }), 'stream_timeout');
});

test('SSE context-window message -> context_window', () => {
  assert.equal(classifyFailure(200, { message: 'input exceeds the context window' }), 'context_window');
  assert.equal(classifyFailure(200, { type: 'api_error', message: 'Your input exceeds the context window of this model. Please adjust your input and try again.' }), 'context_window');
  assert.equal(classifyFailure(400, { type: 'invalid_request_error', message: 'maximum context length exceeded' }), 'context_window');
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

test('context_window must NOT advance the chain (cc shortcut owns recovery on same model)', () => {
  const actions = actionsFor(200, { type: 'api_error', message: 'input exceeds the context window' });
  assert.equal(actions.includes('advance_chain'), false,
    'advancing to a different (often smaller-window) model is the bail the cc shortcut prevents');
  assert.ok(actions.includes('quarantine_route'));
  // Contrast: genuine model failures DO advance the chain.
  assert.ok(actionsFor(429, { type: 'rate_limit_error' }).includes('advance_chain'));
  assert.ok(actionsFor(502, { type: 'stream_timeout' }).includes('advance_chain'));
  assert.ok(actionsFor(503, { type: 'service_unavailable' }).includes('advance_chain'));
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
