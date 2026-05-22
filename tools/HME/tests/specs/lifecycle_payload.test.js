'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { addClaudeTranscript } = require('../../event_kernel/lifecycle_payload');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-payload-'));
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const parentDir = path.dirname(root);
  const ccDir = path.join(parentDir, '.claude', 'projects', '-home-jah-Polychron');
  fs.mkdirSync(ccDir, { recursive: true });
  return { root, ccDir };
}

function writeJsonl(file, lines = []) {
  fs.writeFileSync(file, lines.map(JSON.stringify).join('\n') + '\n');
}

test('addClaudeTranscript respects payload-provided transcript_path', () => {
  const { root, ccDir } = sandbox();
  const parentSession = '00000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const subSession = '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const parentTranscript = path.join(ccDir, `${parentSession}.jsonl`);
  const subTranscript = path.join(ccDir, `${subSession}.jsonl`);
  writeJsonl(parentTranscript, [{ type: 'user', message: { content: 'parent' } }]);
  writeJsonl(subTranscript, [{ type: 'user', message: { content: 'sub' } }]);
  fs.utimesSync(parentTranscript, Date.now() / 1000, Date.now() / 1000);
  const payload = { transcript_path: subTranscript, session_id: subSession };
  const result = addClaudeTranscript(payload, root, 'Stop');
  assert.equal(result.transcript_path, subTranscript, 'subagent transcript_path must not be overwritten by newest');
});

test('addClaudeTranscript picks session-matching transcript when payload omits path', () => {
  const { root, ccDir } = sandbox();
  const parentSession = '00000000-cccc-cccc-cccc-cccccccccccc';
  const subSession = '11111111-dddd-dddd-dddd-dddddddddddd';
  const parentTranscript = path.join(ccDir, `${parentSession}.jsonl`);
  const subTranscript = path.join(ccDir, `${subSession}.jsonl`);
  writeJsonl(parentTranscript, [{ type: 'user', message: { content: 'parent' } }]);
  writeJsonl(subTranscript, [{ type: 'user', message: { content: 'sub' } }]);
  const now = Date.now() / 1000;
  fs.utimesSync(parentTranscript, now, now);
  fs.utimesSync(subTranscript, now - 100, now - 100);
  const payload = { session_id: subSession };
  const result = addClaudeTranscript(payload, root, 'Stop');
  assert.equal(result.transcript_path, subTranscript, 'must resolve via session_id, not by mtime');
});

test('addClaudeTranscript falls back to newest only when neither path nor session is given', () => {
  const { root, ccDir } = sandbox();
  const a = path.join(ccDir, 'aaaaaaaa-1111-1111-1111-111111111111.jsonl');
  const b = path.join(ccDir, 'bbbbbbbb-2222-2222-2222-222222222222.jsonl');
  writeJsonl(a, [{ type: 'user', message: { content: 'older' } }]);
  writeJsonl(b, [{ type: 'user', message: { content: 'newer' } }]);
  const now = Date.now() / 1000;
  fs.utimesSync(a, now - 100, now - 100);
  fs.utimesSync(b, now, now);
  const payload = {};
  const result = addClaudeTranscript(payload, root, 'Stop');
  assert.equal(result.transcript_path, b, 'fallback path is mtime-newest');
});

test('addClaudeTranscript is a no-op for non-Stop events', () => {
  const { root } = sandbox();
  const payload = { transcript_path: '/should/stay' };
  const result = addClaudeTranscript(payload, root, 'PreToolUse');
  assert.equal(result.transcript_path, '/should/stay');
});
