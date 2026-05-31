'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluateOutbound, pickLargerRoute, applyOutboundContextGate } = require('../../proxy/outbound_context_gate');

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

test('pickLargerRoute skips the current model and undersized routes', () => {
  const chain = [{ id: 'cur' }, { id: 'alsosmall' }, { id: 'big' }];
  const budgets = { cur: 1000, alsosmall: 2000, big: 50000 };
  const pick = pickLargerRoute(chain, 5000, 'cur', (id) => budgets[id] || 0);
  assert.equal(pick.id, 'big');
});

test('preflight smoke over-window returns local 413 without lifesaver noise', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-gate-smoke-'));
  const oldRoot = process.env.PROJECT_ROOT;
  const oldBytesPerTok = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  const oldMaxBytes = process.env.HME_PROXY_INTERACTIVE_MAX_BYTES;
  try {
    process.env.PROJECT_ROOT = root;
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
    process.env.HME_PROXY_INTERACTIVE_MAX_BYTES = '100000000';
    fs.mkdirSync(path.join(root, 'log'), { recursive: true });
    const writes = [];
    const clientRes = {
      statusCode: 0,
      headers: null,
      body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
      end(body) { this.body = String(body || ''); },
    };
    const originalAppend = fs.appendFileSync;
    fs.appendFileSync = (file, data, ...args) => { writes.push([String(file), String(data)]); return originalAppend(file, data, ...args); };
    const verdict = applyOutboundContextGate({
      payload: { model: 'lfm-2.5-1.2b-instruct-openrouter-free', max_tokens: 16, messages: [{ role: 'user', content: 'x'.repeat(40000) }] },
      isAnthropic: true,
      isInteractivePath: true,
      isOmniRouteSwap: false,
      swapModel: 'lfm-2.5-1.2b-instruct-openrouter-free',
      swapChain: [{ id: 'lfm-2.5-1.2b-instruct-openrouter-free' }],
      outBody: Buffer.from('{}'),
      sessionForTelemetry: 'smoke-test',
      clientRes,
      clientReq: { headers: { 'x-hme-preflight-smoke': '1' } },
    });
    fs.appendFileSync = originalAppend;
    assert.equal(verdict.ended, true);
    assert.equal(clientRes.statusCode, 413);
    assert.match(clientRes.body, /UPSTREAM_PREFLIGHT_OVER_WINDOW/);
    assert.equal(writes.some(([, data]) => data.includes('[outbound-gate]')), false);
  } finally {
    fs.appendFileSync = fs.appendFileSync.__original || fs.appendFileSync;
    if (oldRoot == null) delete process.env.PROJECT_ROOT; else process.env.PROJECT_ROOT = oldRoot;
    if (oldBytesPerTok == null) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST; else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = oldBytesPerTok;
    if (oldMaxBytes == null) delete process.env.HME_PROXY_INTERACTIVE_MAX_BYTES; else process.env.HME_PROXY_INTERACTIVE_MAX_BYTES = oldMaxBytes;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
