'use strict';
// End-to-end proof that the WIRED proxy handler (maybeDriveReadChain in
// hme_proxy_claude.js) -- not just the read_chain primitives -- drives a complete
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
process.env.PROJECT_ROOT ||= PROJECT_ROOT;
const { maybeDriveReadChain } = require('../../proxy/hme_proxy_claude.js');

// Minimal clientRes capturing what the proxy wrote back.
function fakeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(buf) { this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || ''); },
    json() { return JSON.parse(this.body); },
  };
}

function readToolUse(res) {
  const msg = res.json();
  return msg.content.find((b) => b && b.type === 'tool_use');
}

test('wired handler drives the full read chain with no model decision', () => {
  // 1. Fresh trigger request -> handler answers locally with Read#1.
  const res1 = fakeRes();
  const handled1 = maybeDriveReadChain({
    clientRes: res1,
    payload: { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: '[HME_READ_CHAIN] /a/one.json; /a/two.json' }] }] },
  });
  assert.equal(handled1, true, 'handler must answer the trigger locally (no upstream)');
  assert.equal(res1.statusCode, 200);
  const use1 = readToolUse(res1);
  assert.equal(use1.name, 'Read');
  assert.equal(use1.input.file_path, '/a/one.json');
  assert.match(use1.id, /^hme_read_chain__/, 'id must carry unforgeable read-chain provenance');

  // 2. Client executed Read#1 natively and POSTs back its tool_result. The handler
  //    must re-enter and emit Read#2 -- automatically.
  const res2 = fakeRes();
  const handled2 = maybeDriveReadChain({
    clientRes: res2,
    payload: { model: 'm', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: use1.id, content: '<one bytes>' }] }] },
  });
  assert.equal(handled2, true);
  const use2 = readToolUse(res2);
  assert.equal(use2.input.file_path, '/a/two.json');
  assert.match(use2.id, /^hme_read_chain__/);

  // 3. tool_result for the last file -> handler emits the terminal done message,
  //    not another Read.
  const res3 = fakeRes();
  const handled3 = maybeDriveReadChain({
    clientRes: res3,
    payload: { model: 'm', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: use2.id, content: '<two bytes>' }] }] },
  });
  assert.equal(handled3, true);
  const done = res3.json();
  assert.equal(done.stop_reason, 'end_turn');
  assert.equal(done.content.some((b) => b.type === 'tool_use'), false, 'queue exhausted -> no more reads');
});

test('wired handler returns Anthropic SSE when payload.stream is true', () => {
  const res = fakeRes();
  const handled = maybeDriveReadChain({
    clientRes: res,
    payload: { model: 'm', stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: '[HME_READ_CHAIN] /a/one.json' }] }] },
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['Content-Type'] || ''), /text\/event-stream/);
  assert.match(res.body, /^event: message_start/m);
  assert.match(res.body, /event: content_block_start/);
  assert.match(res.body, /"type":"tool_use"/);
  assert.match(res.body, /event: content_block_delta/);
  assert.match(res.body, /"type":"input_json_delta"/);
  assert.doesNotMatch(res.body.trimStart(), /^\{/);
});

test('wired handler ignores ordinary requests (no false drive)', () => {
  const res = fakeRes();
  const handled = maybeDriveReadChain({
    clientRes: res,
    payload: { model: 'm', messages: [{ role: 'user', content: 'just a normal question' }] },
  });
  assert.equal(handled, false, 'non-trigger requests must pass through to upstream');
  assert.equal(res.statusCode, 0, 'handler must not write anything');
});

test('read-chain tool_use ids are accepted as unforgeable provenance by the consult proof', () => {
  // Cross-check: the python proof collector accepts hme_read_chain__ ids without a
  // nonce. We assert the id SHAPE the proof depends on, locking the contract.
  const rc = require('../../proxy/read_chain.js');
  const id = rc._toolId(0, ['/x/final.json']);
  assert.match(id, /^hme_read_chain__/);
  assert.deepEqual(rc._parseToolId(id), { index: 0, files: ['/x/final.json'] });
});
