'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FAILURE_MOD = '../../proxy/hme_proxy_upstream_failure';

function makeTransport({ statusCode, body = '{}', headers = { 'content-type': 'application/json' }, throws = null, calls = [] }) {
  return {
    request(opts, cb) {
      calls.push({ method: opts.method, headers: { ...opts.headers } });
      const req = {
        _writes: [],
        write(b) { this._writes.push(b); },
        end() {
          if (throws) {
            setImmediate(() => this._onErr && this._onErr(throws));
            return;
          }
          setImmediate(() => {
            const res = {
              statusCode,
              headers,
              on(ev, fn) {
                if (ev === 'data') fn(Buffer.from(body));
                if (ev === 'end') fn();
              },
            };
            cb(res);
          });
        },
        on(ev, fn) { if (ev === 'error') this._onErr = fn; },
      };
      return req;
    },
  };
}

function commonArgs({ transport }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-stream-timeout-retry-'));
  fs.mkdirSync(path.join(tmp, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'log'), { recursive: true });
  const body = '{"error":{"message":"Stream ended before producing useful content","type":"stream_timeout","code":"STREAM_READINESS_TIMEOUT"}}';
  return {
    tmp,
    args: {
      status: 502,
      headers: { 'content-type': 'application/json' },
      fullBody: Buffer.from(body),
      outBody: Buffer.from('{"model":"claude/claude-opus-4-7","stream":true}'),
      clientReq: { method: 'POST', url: '/v1/messages', headers: {} },
      upstreamHeaders: { 'content-type': 'application/json' },
      upstreamOpts: { method: 'POST', headers: { 'content-type': 'application/json' } },
      transport,
      payload: { model: 'claude/claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] },
      isAnthropic: true,
      passthrough: false,
      isOmniRouteSwap: true,
      swapChain: [{ id: 'claude-opus-4-7' }, { id: 'gpt-5.5-xhigh' }],
      odMode: '1',
      omniProvider: 'claude',
      swapModel: 'claude-opus-4-7',
      isInteractivePath: true,
      sessionForTelemetry: 'test-session',
      effectiveCompactThreshold: () => 100000,
      getConsecutive429s: () => 0,
      setConsecutive429s: () => {},
      incConsecutive429s: () => {},
    },
  };
}

test('omniroute 502 stream_timeout retries same target once and returns success', async () => {
  delete require.cache[require.resolve(FAILURE_MOD)];
  const calls = [];
  const transport = makeTransport({ statusCode: 200, body: 'data: {"type":"message_start"}\n\n', headers: { 'content-type': 'text/event-stream' }, calls });
  const { tmp, args } = commonArgs({ transport });
  process.env.PROJECT_ROOT = tmp;
  const { handleUpstreamFailureOrSuccess } = require(FAILURE_MOD);
  const out = await handleUpstreamFailureOrSuccess(args);
  assert.strictEqual(out.status, 200, 'retry success surfaces 200');
  assert.strictEqual(calls.length, 1, 'one retry call issued');
  assert.match(out.fullBody.toString('utf8'), /message_start/);
});

test('omniroute 502 stream_timeout retry that also fails falls through and advances chain', async () => {
  delete require.cache[require.resolve(FAILURE_MOD)];
  const calls = [];
  const transport = makeTransport({ statusCode: 502, body: '{"error":{"type":"stream_timeout"}}', calls });
  const { tmp, args } = commonArgs({ transport });
  process.env.PROJECT_ROOT = tmp;
  const { handleUpstreamFailureOrSuccess } = require(FAILURE_MOD);
  const out = await handleUpstreamFailureOrSuccess(args);
  assert.strictEqual(out.status, 502, 'falls through to original 502');
  assert.strictEqual(calls.length, 1, 'retry attempted exactly once');
  // chain-advance side effect is covered by proxy_extracted_modules.test.js; this
  // test only asserts the new retry-then-fallthrough behavior.
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('non-stream_timeout 502 does not trigger the new retry path', async () => {
  delete require.cache[require.resolve(FAILURE_MOD)];
  const calls = [];
  const transport = makeTransport({ statusCode: 200, body: '{}', calls });
  const { args } = commonArgs({ transport });
  args.fullBody = Buffer.from('{"error":{"message":"upstream blew up","type":"api_error"}}');
  const { handleUpstreamFailureOrSuccess } = require(FAILURE_MOD);
  const out = await handleUpstreamFailureOrSuccess(args);
  assert.strictEqual(out.status, 502);
  assert.strictEqual(calls.length, 0, 'no retry for non-stream_timeout failures');
});
