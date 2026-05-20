'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

function clearProxyCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/proxy/')) delete require.cache[k];
  }
}

function fakeReq(url, method = 'GET') {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = {};
  return req;
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    headersSent: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; this.headersSent = true; },
    end(body = '') { this.body += String(body); },
  };
}

test('proxy route dispatcher handles health/version/stop and probe short-circuits', () => {
  clearProxyCache();
  const { createProxyRouteDispatcher } = require('../../proxy/hme_proxy_routes');
  const dispatch = createProxyRouteDispatcher({
    PORT: 9099,
    PROXY_VERSION: 'test-version',
    PROXY_GIT_SHA: 'test-sha',
    PROXY_STARTED_AT: 'test-start',
    routeMetrics: { direct: 1 },
    stopGateHealth: () => ({ reminder_pending: false, middleware: [] }),
    supervisorStatus: () => ({ worker: { healthy: true } }),
    loadedMiddleware: ['shortcuts_rewriter'],
    handleLifecycleRoute: () => { throw new Error('lifecycle should not run'); },
  });

  for (const [url, expected] of [
    ['/health', { status: 200, field: 'status', value: 'ok' }],
    ['/version', { status: 200, field: 'version', value: 'test-version' }],
    ['/hme/stop-gate/health', { status: 200, field: 'component', value: 'hme-stop-gate' }],
    ['/', { status: 404, field: 'error', value: 'not_found' }],
    ['/favicon.ico', { status: 404, field: 'error', value: 'not_found' }],
    ['/robots.txt', { status: 404, field: 'error', value: 'not_found' }],
  ]) {
    const res = fakeRes();
    assert.equal(dispatch(fakeReq(url), res), true, `${url} dispatched`);
    assert.equal(res.statusCode, expected.status, `${url} status`);
    assert.equal(JSON.parse(res.body)[expected.field], expected.value, `${url} body`);
  }

  const healthRes = fakeRes();
  assert.equal(dispatch(fakeReq('/health'), healthRes), true, '/health dispatched for middleware visibility check');
  assert.deepEqual(JSON.parse(healthRes.body).middleware, ['shortcuts_rewriter']);

  const res = fakeRes();
  assert.equal(dispatch(fakeReq('/v1/messages'), res), false, 'unknown path falls through');
  assert.equal(res.body, '');
});

test('non-lifecycle route dispatch does not import lifecycle bridge', () => {
  clearProxyCache();
  const lifecyclePath = require.resolve('../../proxy/lifecycle_bridge');
  assert.equal(require.cache[lifecyclePath], undefined);
  const { createProxyRouteDispatcher } = require('../../proxy/hme_proxy_routes');
  const dispatch = createProxyRouteDispatcher({
    PORT: 9099,
    PROXY_VERSION: 'test-version',
    PROXY_GIT_SHA: 'test-sha',
    PROXY_STARTED_AT: 'test-start',
    routeMetrics: {},
    stopGateHealth: () => ({}),
  });
  const res = fakeRes();
  assert.equal(dispatch(fakeReq('/version'), res), true);
  assert.equal(require.cache[lifecyclePath], undefined, 'lifecycle bridge stays unloaded');
});

test('admin route handlers are injectable and lazy', () => {
  clearProxyCache();
  const { createProxyRouteDispatcher } = require('../../proxy/hme_proxy_routes');
  const calls = [];
  const handler = (name) => (_req, res) => {
    calls.push(name);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name }));
  };
  const dispatch = createProxyRouteDispatcher({
    PORT: 9099,
    PROXY_VERSION: 'test-version',
    PROXY_GIT_SHA: 'test-sha',
    PROXY_STARTED_AT: 'test-start',
    routeMetrics: {},
    stopGateHealth: () => ({}),
    handleSpawnRoute: handler('spawn'),
    handleLifecycleRoute: handler('lifecycle'),
    handlePreWriteCheckRoute: handler('prewrite'),
    handleSessionStateRoute: handler('session'),
    handleMcpRequest: handler('mcp'),
  });
  for (const [url, name] of [
    ['/hme/spawn', 'spawn'],
    ['/hme/lifecycle?event=SessionStart', 'lifecycle'],
    ['/hme/pre-write-check', 'prewrite'],
    ['/hme/session/state', 'session'],
    ['/mcp', 'mcp'],
  ]) {
    const res = fakeRes();
    assert.equal(dispatch(fakeReq(url, 'POST'), res), true);
    assert.equal(JSON.parse(res.body).name, name);
  }
  assert.deepEqual(calls, ['spawn', 'lifecycle', 'prewrite', 'session', 'mcp']);
});

test('Opus gate disabled returns an idempotent release immediately', async () => {
  clearProxyCache();
  const { createOpusGate } = require('../../proxy/hme_proxy_opus_gate');
  const gate = createOpusGate({ env: { HME_PROXY_OPUS_GATE_OFF: '1' }, log: () => {} });
  const release = await gate.acquireOpusSlot();
  assert.equal(typeof release, 'function');
  release();
  release();
});

test('Opus gate serializes concurrent slots and release is idempotent', async () => {
  clearProxyCache();
  const { createOpusGate } = require('../../proxy/hme_proxy_opus_gate');
  const gate = createOpusGate({ env: { HME_PROXY_OPUS_MIN_GAP_MS: '1' }, log: () => {} });
  const firstPromise = gate.acquireOpusSlot();
  const secondPromise = gate.acquireOpusSlot();
  const firstRelease = await firstPromise;
  let secondResolved = false;
  const secondObserved = secondPromise.then((release) => { secondResolved = true; return release; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(secondResolved, false, 'second slot waits for first release');
  firstRelease();
  firstRelease();
  const secondRelease = await secondObserved;
  assert.equal(secondResolved, true);
  secondRelease();
});
