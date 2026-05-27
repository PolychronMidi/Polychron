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

test('normalizeLifecyclePayload propagates HME_SUBAGENT=1 to payload._hme_subagent', () => {
  const { normalizeLifecyclePayload } = require('../../event_kernel/lifecycle_payload');
  const prior = process.env.HME_SUBAGENT;
  try {
    process.env.HME_SUBAGENT = '1';
    const p = normalizeLifecyclePayload({ host: 'claude', event: 'Stop', root: '/tmp', rawBody: '{}', cwd: '/tmp' });
    assert.equal(p._hme_subagent, true);
  } finally {
    if (prior === undefined) delete process.env.HME_SUBAGENT; else process.env.HME_SUBAGENT = prior;
  }
});

test('normalizeLifecyclePayload leaves _hme_subagent unset without HME_SUBAGENT', () => {
  const { normalizeLifecyclePayload } = require('../../event_kernel/lifecycle_payload');
  const prior = process.env.HME_SUBAGENT;
  try {
    delete process.env.HME_SUBAGENT;
    const p = normalizeLifecyclePayload({ host: 'claude', event: 'Stop', root: '/tmp', rawBody: '{}', cwd: '/tmp' });
    assert.equal(p._hme_subagent, undefined);
  } finally {
    if (prior !== undefined) process.env.HME_SUBAGENT = prior;
  }
});

function codexSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-payload-codex-'));
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  fs.mkdirSync(path.join(codexHome, 'sessions', '2026', '05', '27'), { recursive: true });
  return { root, codexHome };
}

test('addCodexTranscript resolves rollout by session_id under CODEX_HOME', () => {
  const { addCodexTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root, codexHome } = codexSandbox();
  const sid = '019e5ac8-7e92-7020-b62c-8f6af3aced1f';
  const rollout = path.join(codexHome, 'sessions', '2026', '05', '27', `rollout-2026-05-27T15-00-00-${sid}.jsonl`);
  writeJsonl(rollout, [{ timestamp: 't', type: 'session_meta', payload: {} }]);
  const prior = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    const result = addCodexTranscript({ session_id: sid }, root, 'Stop');
    assert.equal(result.transcript_path, rollout);
  } finally {
    if (prior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior;
  }
});

test('addCodexTranscript leaves payload alone for non-Stop events', () => {
  const { addCodexTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root } = codexSandbox();
  const result = addCodexTranscript({ session_id: 'abc' }, root, 'PreToolUse');
  assert.equal(result.transcript_path, undefined);
});

test('addCodexTranscript returns no path when session_id is missing', () => {
  const { addCodexTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root, codexHome } = codexSandbox();
  const prior = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    const result = addCodexTranscript({}, root, 'Stop');
    assert.equal(result.transcript_path, undefined);
  } finally {
    if (prior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior;
  }
});

test('addCodexTranscript respects payload-provided transcript_path', () => {
  const { addCodexTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root, codexHome } = codexSandbox();
  const explicit = path.join(codexHome, 'sessions', '2026', '05', '27', 'explicit.jsonl');
  writeJsonl(explicit, [{ timestamp: 't', type: 'session_meta', payload: {} }]);
  const result = addCodexTranscript({ session_id: 'irrelevant', transcript_path: explicit }, root, 'Stop');
  assert.equal(result.transcript_path, explicit);
});
