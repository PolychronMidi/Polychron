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
  const ccProject = path.join(parentDir, 'Polychron');
  const ccDir = path.join(parentDir, '.claude', 'projects', '-home-jah-Polychron');
  fs.mkdirSync(ccProject, { recursive: true });
  fs.mkdirSync(ccDir, { recursive: true });
  return { root, ccDir, ccProject };
}

function withClaudeProjectDir(root, fn) {
  const prior = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = root;
  try { return fn(); }
  finally {
    if (prior === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prior;
  }
}

function writeJsonl(file, lines = []) {
  fs.writeFileSync(file, lines.map(JSON.stringify).join('\n') + '\n');
}

test('addClaudeTranscript respects payload-provided transcript_path', () => {
  const { root, ccDir, ccProject } = sandbox();
  const parentSession = '00000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const subSession = '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const parentTranscript = path.join(ccDir, `${parentSession}.jsonl`);
  const subTranscript = path.join(ccDir, `${subSession}.jsonl`);
  writeJsonl(parentTranscript, [{ type: 'user', message: { content: 'parent' } }]);
  writeJsonl(subTranscript, [{ type: 'user', message: { content: 'sub' } }]);
  fs.utimesSync(parentTranscript, Date.now() / 1000, Date.now() / 1000);
  const payload = { transcript_path: subTranscript, session_id: subSession };
  const result = withClaudeProjectDir(ccProject, () => addClaudeTranscript(payload, root, 'Stop'));
  assert.equal(result.transcript_path, subTranscript, 'subagent transcript_path must not be overwritten by newest');
});

test('addClaudeTranscript picks session-matching transcript when payload omits path', () => {
  const { root, ccDir, ccProject } = sandbox();
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
  const result = withClaudeProjectDir(ccProject, () => addClaudeTranscript(payload, root, 'Stop'));
  assert.equal(result.transcript_path, subTranscript, 'must resolve via session_id, not by mtime');
});

test('addClaudeTranscript falls back to newest only when neither path nor session is given', () => {
  const { root, ccDir, ccProject } = sandbox();
  const a = path.join(ccDir, 'aaaaaaaa-1111-1111-1111-111111111111.jsonl');
  const b = path.join(ccDir, 'bbbbbbbb-2222-2222-2222-222222222222.jsonl');
  writeJsonl(a, [{ type: 'user', message: { content: 'older' } }]);
  writeJsonl(b, [{ type: 'user', message: { content: 'newer' } }]);
  const now = Date.now() / 1000;
  fs.utimesSync(a, now - 100, now - 100);
  fs.utimesSync(b, now, now);
  const payload = {};
  const result = withClaudeProjectDir(ccProject, () => addClaudeTranscript(payload, root, 'Stop'));
  assert.equal(result.transcript_path, b, 'fallback path is mtime-newest');
});

test('addClaudeTranscript is a no-op for non-Stop events', () => {
  const { root } = sandbox();
  const payload = { transcript_path: '/should/stay' };
  const result = withClaudeProjectDir(ccProject || root, () => addClaudeTranscript(payload, root, 'PreToolUse'));
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

test('addCodexTranscript runs translator when dumper is present', () => {
  const { addCodexTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root, codexHome } = codexSandbox();
  fs.mkdirSync(path.join(root, 'tools', 'HME', 'scripts'), { recursive: true });
  const dumper = path.join(root, 'tools', 'HME', 'scripts', 'codex_dump_transcript.py');
  fs.writeFileSync(dumper, [
    '#!/usr/bin/env python3',
    'import os, sys',
    'src, out = sys.argv[1], sys.argv[2]',
    'os.makedirs(os.path.dirname(out), exist_ok=True)',
    'with open(out, "w") as f:',
    '    f.write(\'{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"translated"}]}}\\n\')',
    'print(out)',
  ].join('\n'));
  const sid = '019eaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const rollout = path.join(codexHome, 'sessions', '2026', '05', '27', `rollout-2026-05-27T15-00-00-${sid}.jsonl`);
  writeJsonl(rollout, [{ timestamp: 't', type: 'session_meta', payload: {} }]);
  const prior = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    const result = addCodexTranscript({ session_id: sid }, root, 'Stop');
    const expected = path.join(root, 'tools', 'HME', 'runtime', 'codex-transcripts', `${sid}.jsonl`);
    assert.equal(result.transcript_path, expected, 'translator output path must be used when dumper succeeds');
    assert.ok(fs.existsSync(expected));
  } finally {
    if (prior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior;
  }
});

function opencodeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-payload-opencode-'));
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'HME', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'HME', 'runtime', 'opencode-transcripts'), { recursive: true });
  const dumper = path.join(root, 'tools', 'HME', 'scripts', 'opencode_dump_transcript.py');
  fs.writeFileSync(dumper, [
    '#!/usr/bin/env python3',
    'import os, sys',
    'session_id = sys.argv[1]',
    'output_path = sys.argv[2]',
    'os.makedirs(os.path.dirname(output_path), exist_ok=True)',
    'with open(output_path, "w") as f:',
    '    f.write(\'{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}\\n\')',
    'print(output_path)',
  ].join('\n'));
  return { root };
}

test('addOpencodeTranscript invokes dumper and sets transcript_path', () => {
  const { addOpencodeTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root } = opencodeSandbox();
  const result = addOpencodeTranscript({ session_id: 'ses_abc' }, root, 'Stop');
  const expected = path.join(root, 'tools', 'HME', 'runtime', 'opencode-transcripts', 'ses_abc.jsonl');
  assert.equal(result.transcript_path, expected);
  assert.ok(fs.existsSync(expected), 'dumper output must exist');
});

test('addOpencodeTranscript is a no-op for non-Stop events', () => {
  const { addOpencodeTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root } = opencodeSandbox();
  const result = addOpencodeTranscript({ session_id: 'ses_abc' }, root, 'PreToolUse');
  assert.equal(result.transcript_path, undefined);
});

test('addOpencodeTranscript returns no path when session_id is missing', () => {
  const { addOpencodeTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root } = opencodeSandbox();
  const result = addOpencodeTranscript({}, root, 'Stop');
  assert.equal(result.transcript_path, undefined);
});

test('addOpencodeTranscript respects payload-provided transcript_path', () => {
  const { addOpencodeTranscript } = require('../../event_kernel/lifecycle_payload');
  const { root } = opencodeSandbox();
  const explicit = path.join(root, 'tmp', 'preset.jsonl');
  fs.writeFileSync(explicit, '{"type":"user","message":{"role":"user","content":[]}}\n');
  const result = addOpencodeTranscript({ session_id: 'irrelevant', transcript_path: explicit }, root, 'Stop');
  assert.equal(result.transcript_path, explicit);
});
