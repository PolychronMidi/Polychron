'use strict';
// Integration test for i/why --deep (Tier 3): writes a queue file and
// emits the [[HME_AGENT_TASK ...]] sentinel. The bridge parses the
// inverse marker (`HME reasoning for <req_id>`) on Agent results.
//
// This test verifies the *contract* on the producer side:
//   1. The queue file appears at tmp/hme-subagent-queue/<req_id>.json
//   2. The queue file's shape matches what subagent_bridge expects
//   3. The emitted stdout contains a sentinel matching the marker regex
//      from _markers.js
//
// We don't actually fire Agent here — that requires a live proxy. We
// verify the producer half of the contract; the consumer half is
// covered by the bridge's own tests.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const I_WHY = path.join(PROJECT_ROOT, 'i', 'why');
const QUEUE_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-queue');
const { MARKERS } = require('../../proxy/middleware/_markers.js');

function _run(args) {
  return spawnSync(I_WHY, args, {
    encoding: 'utf8',
    timeout: 30000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
}

test('i/why --deep emits a sentinel matching the marker contract', () => {
  // Snapshot existing queue entries so we can find the new one
  const before = new Set(fs.existsSync(QUEUE_DIR) ? fs.readdirSync(QUEUE_DIR) : []);

  const r = _run(['integration test question for tier 3', '--deep']);
  assert.strictEqual(r.status, 0, `i/why --deep exited ${r.status}: ${r.stderr}`);

  // 1. Sentinel present in stdout
  const sentinelRe = /\[\[HME_AGENT_TASK\s+req_id=([a-f0-9]{12,})\s+prompt_file=tmp\/hme-subagent-queue\/[a-f0-9]{12,}\.json\s+subagent_type=[a-z\-]+\]\]/;
  const m = sentinelRe.exec(r.stdout);
  assert.ok(m, `expected sentinel in stdout; got:\n${r.stdout.slice(-500)}`);
  const reqId = m[1];

  // 2. Queue file appears with that req_id
  const queuePath = path.join(QUEUE_DIR, `${reqId}.json`);
  assert.ok(fs.existsSync(queuePath), `queue file ${queuePath} missing`);

  // 3. Queue file shape matches what subagent_bridge expects
  const entry = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  assert.strictEqual(entry.req_id, reqId);
  assert.ok(typeof entry.prompt === 'string' && entry.prompt.length > 0,
    'queue entry must have non-empty prompt');
  assert.ok('subagent_type' in entry, 'queue entry must declare subagent_type');
  assert.ok('created_at' in entry && typeof entry.created_at === 'number',
    'queue entry must have numeric created_at');
  assert.ok(entry.prompt.includes('integration test question for tier 3'),
    'prompt must include the original question');

  // 4. The marker reqIdRegex from _markers.js validates the agent-result
  //    side of the contract. Sanity-check it exists and accepts our format.
  assert.ok(MARKERS.HME_AGENT_TASK, '_markers.js must expose HME_AGENT_TASK');
  assert.ok(MARKERS.HME_AGENT_TASK.reqIdRegex instanceof RegExp,
    'HME_AGENT_TASK.reqIdRegex must be a RegExp');
  // The bridge looks for `HME reasoning for <req_id>` in Agent descriptions
  const fakeAgentDesc = `HME reasoning for ${reqId}`;
  const reqMatch = MARKERS.HME_AGENT_TASK.reqIdRegex.exec(fakeAgentDesc);
  assert.ok(reqMatch, 'reqIdRegex must match a properly-formatted Agent description');
  assert.strictEqual(reqMatch[1], reqId);

  // Cleanup: remove the test queue entry so it doesn't pollute the system
  try { fs.unlinkSync(queuePath); } catch (_e) { /* best-effort */ }

  // Sanity: we didn't accidentally remove a pre-existing entry
  for (const f of before) {
    if (f === `${reqId}.json`) continue;  // shouldn't happen but be safe
    assert.ok(fs.existsSync(path.join(QUEUE_DIR, f)),
      `pre-existing queue entry ${f} disappeared during test`);
  }
});

test('i/why without --deep does NOT emit a sentinel', () => {
  const r = _run(['simple question without deep flag']);
  assert.strictEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /\[\[HME_AGENT_TASK/,
    'sentinel must only fire on --deep');
  // Should still mention --deep as the next step
  assert.match(r.stdout, /--deep/, 'output should hint at the --deep upgrade path');
});
