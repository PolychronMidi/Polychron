'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = path.join(ROOT, 'tools/HME/scripts/read-chain-transcript-bridge.js');

test('PostToolUse Read bridge stamps hme_read_chain proof rows into host transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-read-chain-bridge-'));
  try {
    const runtime = path.join(dir, 'tools/HME/runtime');
    fs.mkdirSync(runtime, { recursive: true });
    const file = path.join(dir, 'teams/runtime/output/unit/red_final.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"reply":"ok"}\n');
    fs.writeFileSync(path.join(runtime, 'latest-consult-read-queue.json'), JSON.stringify({
      schema: 2,
      round: 'unit',
      consumed: true,
      native_read_before_report: ['teams/runtime/output/unit/red_final.json'],
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }));
    const transcript = path.join(dir, 'session.jsonl');
    const payload = {
      transcript_path: transcript,
      tool_input: { file_path: file },
      tool_response: { content: [{ type: 'text', text: '1\t{"reply":"ok"}' }] },
    };
    const res = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, PROJECT_ROOT: dir } });
    assert.equal(res.status, 0, res.stderr);
    const rows = fs.readFileSync(transcript, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].message.content[0].name, 'Read');
    assert.match(rows[0].message.content[0].id, /^hme_read_chain__bridge__/);
    assert.equal(rows[1].message.content[0].tool_use_id, rows[0].message.content[0].id);
    const marker = JSON.parse(fs.readFileSync(path.join(runtime, 'latest-consult-read-queue.json'), 'utf8'));
    assert.deepEqual(marker.proved_native_reads, ['teams/runtime/output/unit/red_final.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
