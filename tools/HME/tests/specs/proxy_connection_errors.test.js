'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  handleMidResponseError,
  shouldRetryConnectionError,
  handleConnectionError,
} = require('../../proxy/hme_proxy_connection_errors');

function fakeRes(headersSent = false) {
  return {
    headersSent,
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; this.headersSent = true; },
    write(body = '') { this.body += String(body); this.headersSent = true; },
    end(body = '') { this.body += String(body); },
  };
}

test('connection retry decision is first interactive pre-header retryable only', () => {
  assert.equal(shouldRetryConnectionError({ connRetryEnabled: true, isInteractivePath: true, connAttempt: 1, clientRes: fakeRes(false), errCode: 'ECONNRESET' }), true);
  assert.equal(shouldRetryConnectionError({ connRetryEnabled: true, isInteractivePath: true, connAttempt: 2, clientRes: fakeRes(false), errCode: 'ECONNRESET' }), false);
  assert.equal(shouldRetryConnectionError({ connRetryEnabled: true, isInteractivePath: false, connAttempt: 1, clientRes: fakeRes(false), errCode: 'ECONNRESET' }), false);
  assert.equal(shouldRetryConnectionError({ connRetryEnabled: true, isInteractivePath: true, connAttempt: 1, clientRes: fakeRes(true), errCode: 'ECONNRESET' }), false);
  assert.equal(shouldRetryConnectionError({ connRetryEnabled: true, isInteractivePath: true, connAttempt: 1, clientRes: fakeRes(false), errCode: 'ENOTRETRY' }), false);
});

test('connection error retries without writing a 502', () => {
  let released = 0;
  let spawned = 0;
  const res = fakeRes(false);
  handleConnectionError({
    err: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    clientRes: res,
    isInteractivePath: true,
    connAttempt: 1,
    outBody: Buffer.from('{}'),
    releaseOpusSlot: () => { released += 1; },
    spawnUpstream: () => { spawned += 1; },
    recordFailure: () => { throw new Error('should not record before retry'); },
    connRetryEnabled: true,
    emitFn: () => {},
    log: () => {},
  });
  assert.equal(released, 1);
  assert.equal(spawned, 1);
  assert.equal(res.body, '');
});

test('connection error snapshots payload and emits shaped 502', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-conn-error-'));
  try {
    let recorded = '';
    let emitted = null;
    const res = fakeRes(false);
    handleConnectionError({
      err: Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }),
      clientRes: res,
      isInteractivePath: true,
      connAttempt: 2,
      outBody: Buffer.from('{"x":1}'),
      releaseOpusSlot: () => {},
      spawnUpstream: () => { throw new Error('should not retry'); },
      recordFailure: (msg) => { recorded = msg; },
      connRetryEnabled: true,
      emitFn: (event) => { emitted = event; },
      log: () => {},
      projectRoot: root,
    });
    assert.match(recorded, /ECONNREFUSED/);
    assert.equal(emitted.event, 'upstream_conn_error');
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error.type, 'hme_proxy_upstream');
    const snapshots = fs.readdirSync(path.join(root, 'tmp')).filter((f) => f.includes('ECONNREFUSED'));
    assert.equal(snapshots.length, 1);
    assert.equal(fs.readFileSync(path.join(root, 'tmp', snapshots[0]), 'utf8'), '{"x":1}');
    assert.match(fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8'), /UPSTREAM_ECONNREFUSED_INTERACTIVE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mid-response error emits shaped 502 and best-effort log', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-mid-error-'));
  try {
    fs.mkdirSync(path.join(root, 'log'), { recursive: true });
    let recorded = '';
    let emitted = null;
    const res = fakeRes(false);
    handleMidResponseError({
      err: Object.assign(new Error('stream died'), { code: 'EPIPE' }),
      clientRes: res,
      isInteractivePath: true,
      releaseOpusSlot: () => {},
      recordFailure: (msg) => { recorded = msg; },
      emitFn: (event) => { emitted = event; },
      log: () => {},
      projectRoot: root,
    });
    assert.match(recorded, /mid-response/);
    assert.equal(emitted.event, 'upstream_midresponse_error');
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error.type, 'hme_proxy_upstream_midresponse');
    assert.match(fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8'), /UPSTREAM_EPIPE_INTERACTIVE_MIDRESPONSE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('interactive ECONNRESET mid-response recovers with Anthropic stop SSE', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-mid-reset-'));
  try {
    let recorded = '';
    let emitted = null;
    const res = fakeRes(false);
    handleMidResponseError({
      err: Object.assign(new Error('aborted'), { code: 'ECONNRESET' }),
      clientRes: res,
      isInteractivePath: true,
      releaseOpusSlot: () => {},
      recordFailure: (msg) => { recorded = msg; },
      emitFn: (event) => { emitted = event; },
      log: () => {},
      projectRoot: root,
      model: 'claude-test',
    });
    assert.equal(recorded, '');
    assert.equal(emitted.event, 'upstream_midresponse_recovered');
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: message_start/);
    assert.match(res.body, /event: message_stop/);
    assert.equal(fs.existsSync(path.join(root, 'log/hme-errors.log')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
