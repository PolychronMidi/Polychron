'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluateOutbound, pickLargerRoute, applyOutboundContextGate, effectiveInputBudgetForPayload } = require('../../proxy/outbound_context_gate');
const { prepareUpstreamHeaders, shouldInjectLoopbackOauth } = require('../../proxy/hme_proxy_headers');

// A payload whose estimated input tokens we control via an injected estimate fn,
// so the test is deterministic and independent of live models.json.
const mkPayload = () => ({ model: 'claude/small-ctx', messages: [{ role: 'user', content: 'x' }], system: '', tools: [] });

test('fit: under budget passes through untouched', () => {
  const v = evaluateOutbound({
    payload: mkPayload(), modelId: 'small-ctx', swapChain: [],
    deps: { estimate: () => 100, inputBudgetFor: () => 1000, compact: () => { throw new Error('must not compact'); } },
  });
  assert.equal(v.ok, true);
  assert.equal(v.action, 'fit');
});

test('compact-first: over budget, compaction brings it under -> compacted', () => {
  let compacted = false;
  let calls = 0;
  const v = evaluateOutbound({
    payload: mkPayload(), modelId: 'small-ctx', swapChain: [],
    deps: {
      estimate: () => (compacted ? 500 : 2000),   // first estimate over, post-compact under
      inputBudgetFor: () => 1000,
      compact: () => { compacted = true; calls += 1; },
    },
  });
  assert.equal(calls, 1, 'compaction attempted exactly once');
  assert.equal(v.ok, true);
  assert.equal(v.action, 'compacted');
});

test('reroute: compaction insufficient, larger-context route in chain -> rerouted', () => {
  const chain = [{ id: 'small-ctx' }, { id: 'big-ctx' }];
  const budgets = { 'small-ctx': 1000, 'big-ctx': 100000 };
  const v = evaluateOutbound({
    payload: mkPayload(), modelId: 'small-ctx', swapChain: chain,
    deps: {
      estimate: () => 5000,                         // stays over small-ctx even after compact
      inputBudgetFor: (id) => budgets[id] || 0,
      compact: () => {},
    },
  });
  assert.equal(v.ok, true);
  assert.equal(v.action, 'rerouted');
  assert.equal(v.model, 'big-ctx');
});

test('GATE CAN FAIL: over budget, compaction and reroute exhausted -> over_window', () => {
  const chain = [{ id: 'small-ctx' }];   // no larger route available
  const v = evaluateOutbound({
    payload: mkPayload(), modelId: 'small-ctx', swapChain: chain,
    deps: {
      estimate: () => 5000,
      inputBudgetFor: () => 1000,
      compact: () => {},
    },
  });
  assert.equal(v.ok, false);
  assert.equal(v.action, 'over_window');
  assert.equal(v.tokens, 5000);
  assert.equal(v.budget, 1000);
});

test('fail-open: unknown budget (0) never blocks', () => {
  const v = evaluateOutbound({
    payload: mkPayload(), modelId: 'mystery', swapChain: [],
    deps: { estimate: () => 9_999_999, inputBudgetFor: () => 0, compact: () => {} },
  });
  assert.equal(v.ok, true);
  assert.equal(v.action, 'fit');
});

test('fresh statusline truth prevents conservative-estimator false over-window', () => {
  const v = evaluateOutbound({
    payload: mkPayload(), modelId: 'gpt-5.5-xhigh', swapChain: [],
    deps: {
      estimate: () => 352200,
      inputBudgetFor: () => 352000,
      compact: () => { throw new Error('must not compact'); },
      statuslineUsage: () => ({ used: 200000, size: 1000000, modelId: 'claude-opus-4-8[1m]' }),
    },
  });
  assert.equal(v.ok, true);
  assert.equal(v.action, 'fit');
  assert.equal(v.tokens, 200000);
  assert.equal(v.source, 'statusline');
});

test('dynamic budget uses requested output instead of full max-output reserve', () => {
  const budget = effectiveInputBudgetForPayload(
    { max_tokens: 16 },
    'small',
    () => 352000,
    {},
  );
  // Unknown model metadata in this injected call falls back to the static budget;
  // full integration is below using real gpt-5.5 registry metadata.
  assert.equal(budget, 352000);

  const v = evaluateOutbound({
    payload: { model: 'gpt-5.5-xhigh', max_tokens: 16, messages: [{ role: 'user', content: 'x' }] },
    modelId: 'gpt-5.5-xhigh',
    swapChain: [],
    deps: {
      estimate: () => 352895,
      inputBudgetFor: () => 352000,
      compact: () => { throw new Error('must not compact'); },
      statuslineUsage: () => ({ used: 0, size: 0, modelId: '' }),
    },
  });
  assert.equal(v.ok, true);
  assert.equal(v.action, 'fit');
  assert.ok(v.budget > 352895, `dynamic budget ${v.budget} should hold requested small-output payload`);
});

test('pickLargerRoute skips the current model and undersized routes', () => {
  const chain = [{ id: 'cur' }, { id: 'alsosmall' }, { id: 'big' }];
  const budgets = { cur: 1000, alsosmall: 2000, big: 50000 };
  const pick = pickLargerRoute(chain, 5000, 'cur', (id) => budgets[id] || 0);
  assert.equal(pick.id, 'big');
});

test('preflight smoke ignores statusline and returns local 400 without lifesaver noise', () => {
  const oldBytesPerTok = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  const oldMaxBytes = process.env.HME_PROXY_INTERACTIVE_MAX_BYTES;
  const originalAppend = fs.appendFileSync;
  const writes = [];
  let compactCalls = 0;
  try {
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_INTERACTIVE_MAX_BYTES = '100000000';
    const clientRes = {
      statusCode: 0,
      headers: null,
      body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
      end(body) { this.body = String(body || ''); },
    };
    fs.appendFileSync = (file, data, ...args) => { writes.push([String(file), String(data)]); return originalAppend(file, data, ...args); };
    const verdict = applyOutboundContextGate({
      payload: { model: 'lfm-2.5-1.2b-instruct-openrouter-free', max_tokens: 16, messages: [{ role: 'user', content: 'x'.repeat(160000) }] },
      isAnthropic: true,
      isInteractivePath: true,
      isOmniRouteSwap: false,
      swapModel: 'lfm-2.5-1.2b-instruct-openrouter-free',
      swapChain: [{ id: 'lfm-2.5-1.2b-instruct-openrouter-free' }],
      outBody: Buffer.from('{}'),
      sessionForTelemetry: 'smoke-test',
      clientRes,
      clientReq: { headers: { 'x-hme-preflight-smoke': '1' } },
      compactSubmitter: () => { compactCalls += 1; return { submitted: true, reason: 'submitted' }; },
    });
    assert.equal(verdict.ended, true);
    assert.equal(clientRes.statusCode, 400);
    assert.match(clientRes.body, /UPSTREAM_PREFLIGHT_OVER_WINDOW/);
    assert.equal(writes.some(([, data]) => data.includes('[outbound-gate]')), false);
    assert.equal(compactCalls, 0, 'preflight smoke must not drive live cc shortcut');
  } finally {
    fs.appendFileSync = originalAppend;
    if (oldBytesPerTok == null) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST; else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = oldBytesPerTok;
    if (oldMaxBytes == null) delete process.env.HME_PROXY_INTERACTIVE_MAX_BYTES; else process.env.HME_PROXY_INTERACTIVE_MAX_BYTES = oldMaxBytes;
  }
});

test('preflight smoke that fits terminates locally before upstream auth', () => {
  const clientRes = {
    statusCode: 0,
    headers: null,
    body: 'unset',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body == null ? '' : String(body); },
  };
  const verdict = applyOutboundContextGate({
    payload: { model: 'lfm-2.5-1.2b-instruct-openrouter-free', max_tokens: 16, messages: [{ role: 'user', content: 'ok' }] },
    isAnthropic: true,
    isInteractivePath: true,
    isOmniRouteSwap: false,
    swapModel: 'lfm-2.5-1.2b-instruct-openrouter-free',
    swapChain: [{ id: 'lfm-2.5-1.2b-instruct-openrouter-free' }],
    outBody: Buffer.from('{}'),
    sessionForTelemetry: 'smoke-fit',
    clientRes,
    clientReq: { headers: { 'x-hme-preflight-smoke': '1' } },
    compactSubmitter: () => { throw new Error('must not compact'); },
  });
  assert.equal(verdict.ended, true);
  assert.equal(clientRes.statusCode, 204);
  assert.equal(clientRes.body, '');
});

test('preflight smoke headers never promote fake auth to Claude OAuth', () => {
  const clientReq = {
    headers: {
      authorization: 'Bearer hme-preflight',
      'x-hme-preflight-smoke': '1',
      host: '127.0.0.1:1',
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const headers = prepareUpstreamHeaders({
    clientReq,
    upstream: { host: 'api.anthropic.com' },
    outBody: Buffer.from('{}'),
    isAnthropic: true,
    isOmniRouteSwap: false,
  });
  assert.equal(headers.authorization, 'Bearer hme-preflight');
  assert.equal(headers['anthropic-beta'], undefined);
  assert.equal(shouldInjectLoopbackOauth({ clientReq, upstreamHeaders: { 'x-hme-preflight-smoke': '1' }, isAnthropic: true, isOmniRouteSwap: false }), false);
});

test('interactive over-window refusal returns local 400 and triggers live cc compact once', () => {
  const oldBytesPerTok = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  const originalAppend = fs.appendFileSync;
  const writes = [];
  let compactCalls = 0;
  try {
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    const clientRes = {
      statusCode: 0,
      headers: null,
      body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
      end(body) { this.body = String(body || ''); },
    };
    const fixtureRoot = path.join(os.tmpdir(), 'hme-outbound-gate-test');
    fs.appendFileSync = (_file, data, ..._args) => { writes.push(String(data)); };
    const verdict = applyOutboundContextGate({
      payload: { model: 'lfm-2.5-1.2b-instruct-openrouter-free', max_tokens: 16, messages: [{ role: 'user', content: 'x'.repeat(160000) }] },
      isAnthropic: true,
      isInteractivePath: true,
      isOmniRouteSwap: false,
      swapModel: 'lfm-2.5-1.2b-instruct-openrouter-free',
      swapChain: [{ id: 'lfm-2.5-1.2b-instruct-openrouter-free' }],
      outBody: Buffer.from('{}'),
      sessionForTelemetry: 'live-test',
      clientRes,
      clientReq: { headers: {} },
      projectRoot: fixtureRoot,
      compactSubmitter: (root) => {
        compactCalls += 1;
        assert.equal(root, fixtureRoot);
        return { submitted: true, reason: 'submitted' };
      },
    });
    assert.equal(verdict.ended, true);
    assert.equal(clientRes.statusCode, 400);
    assert.equal(compactCalls, 1, 'real interactive over-window must deploy the cc shortcut');
    assert.ok(writes.some((line) => line.includes('cc_compact=submitted')));
  } finally {
    fs.appendFileSync = originalAppend;
    if (oldBytesPerTok == null) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST; else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = oldBytesPerTok;
  }
});
