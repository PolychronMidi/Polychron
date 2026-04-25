'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const wq = require('../../proxy/worker_queue');

test('worker_queue: dropJob writes an atomic file', () => {
  const id = wq.dropJob('test-endpoint', { hello: 'world' });
  assert.match(id, /^[a-f0-9]{16}$/);
  const file = path.join(wq.QUEUE_DIR, 'test-endpoint', `${id}.json`);
  assert.ok(fs.existsSync(file), 'queue file must exist after drop');
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(body.jobId, id);
  assert.strictEqual(body.endpoint, 'test-endpoint');
  assert.deepStrictEqual(body.body, { hello: 'world' });
  assert.ok(typeof body.ts === 'number');
  // cleanup
  fs.unlinkSync(file);
});

test('worker_queue: waitForResult times out cleanly when no result arrives', async () => {
  const id = 'nonexistent_' + Date.now();
  const start = Date.now();
  const result = await wq.waitForResult(id, 200, 50);
  const elapsed = Date.now() - start;
  assert.strictEqual(result, null);
  assert.ok(elapsed >= 200 && elapsed < 600, `expected ~200ms timeout, got ${elapsed}ms`);
});

test('worker_queue: waitForResult reads + deletes result on success', async () => {
  const id = 'sync_' + Date.now();
  const resultFile = path.join(wq.RESULTS_DIR, `${id}.json`);
  fs.mkdirSync(wq.RESULTS_DIR, { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify({ ok: true, foo: 'bar' }));

  const result = await wq.waitForResult(id, 1000, 50);
  assert.deepStrictEqual(result, { ok: true, foo: 'bar' });
  assert.ok(!fs.existsSync(resultFile), 'result file must be deleted after read');
});
