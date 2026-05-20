'use strict';
const { requireEnv: _hmeRequireEnv } = require('../../proxy/shared/load_env.js');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const repo = _hmeRequireEnv('PROJECT_ROOT');

function clearProxyCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/proxy/')) delete require.cache[k];
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: 'Bearer test-token',
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('Claude handler forwards to fake Anthropic upstream and returns success without lifecycle import', async () => {
  clearProxyCache();
  const prevEnv = {
    host: process.env.HME_PROXY_UPSTREAM_HOST,
    port: process.env.HME_PROXY_UPSTREAM_PORT,
    tls: process.env.HME_PROXY_UPSTREAM_TLS,
    inject: process.env.HME_INJECT_TOOLS,
    proxyInject: process.env.HME_PROXY_INJECT,
    quiet: process.env.HME_PROXY_QUIET_IMPORT,
    overdrive: process.env.OVERDRIVE_MODE,
  };
  let upstreamBody = null;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      upstreamBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, {
        'content-type': 'application/json',
        'anthropic-ratelimit-input-tokens-remaining': '12345',
        'anthropic-ratelimit-input-tokens-limit': '20000',
      });
      res.end(JSON.stringify({
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  const proxy = http.createServer();
  try {
    const upstreamPort = await listen(upstream);
    process.env.HME_PROXY_UPSTREAM_HOST = '127.0.0.1';
    process.env.HME_PROXY_UPSTREAM_PORT = String(upstreamPort);
    process.env.HME_PROXY_UPSTREAM_TLS = '0';
    process.env.HME_INJECT_TOOLS = '0';
    process.env.HME_PROXY_INJECT = '0';
    process.env.HME_PROXY_QUIET_IMPORT = '1';
    clearProxyCache();
    const lifecyclePath = require.resolve('../../proxy/lifecycle_bridge');
    assert.equal(require.cache[lifecyclePath], undefined);
    const { createClaudeHandler } = require('../../proxy/hme_proxy_claude');
    let routeRecorded = null;
    let lastRemaining = null;
    let lastLimit = null;
    proxy.on('request', createClaudeHandler({
      PORT: 9099,
      PROXY_VERSION: 'test',
      PROXY_GIT_SHA: 'test',
      PROXY_STARTED_AT: 'test',
      routeMetrics: {},
      recordProxyRoute(route, model) { routeRecorded = { route, model }; },
      effectiveCompactThreshold() { return 250000; },
      shrinkForPassthrough() { return 0; },
      shrinkForContext() { return 0; },
      injectContextHeader() {},
      async acquireOpusSlot() { return () => {}; },
      anthropicTextSseBuffer() { return Buffer.from(''); },
      getConsecutive429s() { return 0; },
      setConsecutive429s() {},
      incConsecutive429s() { return 0; },
      getLastInputTokensRemaining() { return lastRemaining; },
      setLastInputTokensRemaining(n) { lastRemaining = n; },
      getLastInputTokensLimit() { return lastLimit; },
      setLastInputTokensLimit(n) { lastLimit = n; },
      setLastPayloadBytes() {},
      lifecycleInactive() { return false; },
      runInlineFallback() { throw new Error('inline fallback should not run'); },
      skipStopFallback: true,
    }));
    const proxyPort = await listen(proxy);
    const payload = JSON.stringify({ model: 'claude-test', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
    const res = await request(proxyPort, payload);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).content[0].text, 'ok');
    assert.deepEqual(routeRecorded, { route: 'direct', model: 'claude-test' });
    assert.equal(lastRemaining, 12345);
    assert.equal(lastLimit, 20000);
    assert.equal(JSON.parse(upstreamBody).messages[0].content, 'hi');
    assert.equal(require.cache[lifecyclePath], undefined, 'simple success path should not import lifecycle bridge');
  } finally {
    if (prevEnv.host === undefined) delete process.env.HME_PROXY_UPSTREAM_HOST; else process.env.HME_PROXY_UPSTREAM_HOST = prevEnv.host;
    if (prevEnv.port === undefined) delete process.env.HME_PROXY_UPSTREAM_PORT; else process.env.HME_PROXY_UPSTREAM_PORT = prevEnv.port;
    if (prevEnv.tls === undefined) delete process.env.HME_PROXY_UPSTREAM_TLS; else process.env.HME_PROXY_UPSTREAM_TLS = prevEnv.tls;
    if (prevEnv.inject === undefined) delete process.env.HME_INJECT_TOOLS; else process.env.HME_INJECT_TOOLS = prevEnv.inject;
    if (prevEnv.proxyInject === undefined) delete process.env.HME_PROXY_INJECT; else process.env.HME_PROXY_INJECT = prevEnv.proxyInject;
    if (prevEnv.quiet === undefined) delete process.env.HME_PROXY_QUIET_IMPORT; else process.env.HME_PROXY_QUIET_IMPORT = prevEnv.quiet;
    clearProxyCache();
    await close(proxy).catch(() => {});
    await close(upstream).catch(() => {});
  }
});
