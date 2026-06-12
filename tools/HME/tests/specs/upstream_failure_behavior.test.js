'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROXY_DIR = path.resolve(__dirname, '..', '..', 'proxy');

function clearProxyRequireCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(PROXY_DIR)) delete require.cache[k];
  }
}

async function withSandboxedProxy(fn) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-upstream-failure-'));
  const originalRoot = process.env.PROJECT_ROOT;
  const originalThreshold = process.env.HME_OMNI_SWAP_FAIL_THRESHOLD;
  try {
    fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
    process.env.PROJECT_ROOT = sandbox;
    process.env.HME_OMNI_SWAP_FAIL_THRESHOLD = '2';
    clearProxyRequireCache();
    const { handleUpstreamFailureOrSuccess } = require('../../proxy/contexts/failure_policy/hme_proxy_upstream_failure');
    const { swapStore } = require('../../proxy/contexts/upstream_dispatch');
    await fn({ handleUpstreamFailureOrSuccess, swapStore, sandbox });
  } finally {
    if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = originalRoot;
    if (originalThreshold === undefined) delete process.env.HME_OMNI_SWAP_FAIL_THRESHOLD;
    else process.env.HME_OMNI_SWAP_FAIL_THRESHOLD = originalThreshold;
    clearProxyRequireCache();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function sseErrorBody(err) {
  return Buffer.from(`event: error\ndata: ${JSON.stringify(err)}\n\n`, 'utf8');
}

function jsonErrorBody(type, message) {
  return Buffer.from(JSON.stringify({ error: { type, message } }), 'utf8');
}

function argsForFailure({ status, headers, fullBody, payload, swapChain }) {
  const outBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    status,
    headers,
    fullBody,
    outBody,
    clientReq: { method: 'POST', url: '/v1/messages', headers: { host: 'proxy.test' } },
    upstreamHeaders: { 'content-type': 'application/json' },
    upstreamOpts: { method: 'POST', path: '/v1/messages', headers: {} },
    transport: { request: () => { throw new Error('transport must not be used by this regression'); } },
    payload,
    isAnthropic: true,
    passthrough: false,
    isOmniRouteSwap: true,
    swapChain,
    odMode: 'test',
    omniProvider: 'openai',
    swapModel: 'gpt-5.5-xhigh',
    isInteractivePath: false,
    sessionForTelemetry: 'test-session',
    effectiveCompactThreshold: () => ({ threshold: 1 }),
    getConsecutive429s: () => 0,
    setConsecutive429s: () => {},
    incConsecutive429s: () => {},
  };
}

test('context_window upstream failure does not increment OmniRoute swap-chain streak', async () => {
  await withSandboxedProxy(async ({ handleUpstreamFailureOrSuccess, swapStore, sandbox }) => {
    const swapChain = [
      { provider: 'openai', id: 'gpt-5.5-xhigh' },
      { provider: 'openai', id: 'gpt-5.5-high' },
    ];
    const payload = { model: 'openai/gpt-5.5-xhigh', messages: [{ role: 'user', content: 'hi' }] };

    const contextWindow = argsForFailure({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      fullBody: sseErrorBody({ type: 'api_error', message: 'input exceeds the context window' }),
      payload,
      swapChain,
    });
    const contextResult = await handleUpstreamFailureOrSuccess(contextWindow);
    assert.equal(contextResult.status, 200);
    assert.deepEqual(
      swapStore.peek(sandbox),
      { idx: 0, ts: 0, fail: 0, pending: 0, chain: '' },
      'context-window recovery must leave swap fail streak untouched so cc shortcut can recover on the same model',
    );

    const upstream5xx = argsForFailure({
      status: 503,
      headers: { 'content-type': 'application/json' },
      fullBody: jsonErrorBody('service_unavailable', 'provider unavailable'),
      payload,
      swapChain,
    });
    const failureResult = await handleUpstreamFailureOrSuccess(upstream5xx);
    assert.equal(failureResult.status, 503);
    const state = swapStore.peek(sandbox);
    assert.equal(state.idx, 0);
    assert.equal(state.fail, 1);
    assert.equal(state.pending, 1);
    assert.equal(state.chain, 'openai:gpt-5.5-xhigh|openai:gpt-5.5-high');
  });
});
