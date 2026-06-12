'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wq = require('../../proxy/worker_queue');

function isolatedClient() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-worker-queue-test-'));
  return { root, client: wq.createClient(root) };
}

test('worker_queue: dropJob writes an atomic file', () => {
  const { root, client } = isolatedClient();
  try {
    const id = client.dropJob('test-endpoint', { hello: 'world' });
    assert.match(id, /^[a-f0-9]{16}$/);
    const file = path.join(client.QUEUE_DIR, 'test-endpoint', `${id}.json`);
    assert.ok(fs.existsSync(file), 'queue file must exist after drop');
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(body.jobId, id);
    assert.strictEqual(body.endpoint, 'test-endpoint');
    assert.deepStrictEqual(body.body, { hello: 'world' });
    assert.ok(typeof body.ts === 'number');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('worker_queue: waitForResult times out cleanly when no result arrives', async () => {
  const { root, client } = isolatedClient();
  try {
    const id = 'nonexistent_' + Date.now();
    const start = Date.now();
    const result = await client.waitForResult(id, 200, 50);
    const elapsed = Date.now() - start;
    assert.strictEqual(result, null);
    assert.ok(elapsed >= 200 && elapsed < 600, `expected ~200ms timeout, got ${elapsed}ms`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('worker_queue: waitForResult reads + deletes result on success', async () => {
  const { root, client } = isolatedClient();
  try {
    const id = 'sync_' + Date.now();
    const resultFile = path.join(client.RESULTS_DIR, `${id}.json`);
    fs.mkdirSync(client.RESULTS_DIR, { recursive: true });
    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, foo: 'bar' }));

    const result = await client.waitForResult(id, 1000, 50);
    assert.deepStrictEqual(result, { ok: true, foo: 'bar' });
    assert.ok(!fs.existsSync(resultFile), 'result file must be deleted after read');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
