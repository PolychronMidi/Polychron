'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireEnv } = require('../../proxy/shared/load_env');

process.env.PROJECT_ROOT = requireEnv('PROJECT_ROOT');

const decision = require('../../event_kernel/decision');
const guard = require('../../proxy/claim_proof_guard');
const policy = require('../../proxy/stop_chain/policies/claim_proof');

function writeTranscript(dir, events) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

function ctxFor(transcriptPath, root) {
  return {
    payload: transcriptPath ? { transcript_path: transcriptPath } : {},
    projectRoot: root,
    deny: decision.deny,
    instruct: decision.instruct,
    allow: decision.allow,
  };
}

function turn(userText, assistantBlocks) {
  return [
    { type: 'user', message: { content: [{ type: 'text', text: userText }] } },
    { type: 'assistant', message: { content: assistantBlocks } },
  ];
}

test('isAbsoluteCompletion targets the over-reaching shape, not scoped fixes', () => {
  assert.equal(guard.isAbsoluteCompletion('all tests pass, everything is fixed'), true);
  assert.equal(guard.isAbsoluteCompletion('fully resolved'), true);
  assert.equal(guard.isAbsoluteCompletion('fixed the typo in line 4'), false);
  assert.equal(guard.isAbsoluteCompletion('renamed a variable'), false);
});

test('DENY (strict): edited + absolute completion claim + no verification this turn', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claimproof-'));
  const prev = process.env.strict_mode;
  process.env.strict_mode = '1';
  try {
    const tp = writeTranscript(root, turn('fix the bug', [
      { type: 'tool_use', name: 'Edit', input: {} },
      { type: 'text', text: 'All tests pass now and everything is fixed.' },
    ]));
    const v = policy.run(ctxFor(tp, root));
    assert.equal(v.decision, 'deny');
    assert.match(v.reason, /CLAIM-PROOF/);
  } finally {
    if (prev === undefined) delete process.env.strict_mode; else process.env.strict_mode = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SHADOW (non-strict): same case instructs instead of denying', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claimproof-'));
  const prev = process.env.strict_mode;
  process.env.strict_mode = '0';
  try {
    const tp = writeTranscript(root, turn('fix the bug', [
      { type: 'tool_use', name: 'Edit', input: {} },
      { type: 'text', text: 'All tests pass now and everything is fixed.' },
    ]));
    const v = policy.run(ctxFor(tp, root));
    assert.equal(v.decision, 'instruct');
    assert.match(v.message, /shadow/);
  } finally {
    if (prev === undefined) delete process.env.strict_mode; else process.env.strict_mode = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ALLOW: same absolute claim but a Bash verification ran this turn', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claimproof-'));
  try {
    const tp = writeTranscript(root, turn('fix the bug', [
      { type: 'tool_use', name: 'Edit', input: {} },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      { type: 'text', text: 'All tests pass now and everything is fixed.' },
    ]));
    assert.equal(policy.run(ctxFor(tp, root)).decision, 'allow');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('INSTRUCT: scoped completion claim with no verification is advisory, not deny', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claimproof-'));
  try {
    const tp = writeTranscript(root, turn('fix the typo', [
      { type: 'tool_use', name: 'Edit', input: {} },
      { type: 'text', text: 'Fixed the typo.' },
    ]));
    assert.equal(policy.run(ctxFor(tp, root)).decision, 'instruct');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ALLOW: ordinary (non-claim) assistant text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-claimproof-'));
  try {
    const tp = writeTranscript(root, turn('what does this do', [
      { type: 'text', text: 'This module routes requests to the proxy.' },
    ]));
    assert.equal(policy.run(ctxFor(tp, root)).decision, 'allow');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('FAIL-OPEN: missing transcript allows (never wedges the chain)', () => {
  assert.equal(policy.run(ctxFor(null, process.env.PROJECT_ROOT)).decision, 'allow');
});

test('registered as a non-mandatory, strict-only stop policy', () => {
  const src = fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'tools/HME/proxy/stop_chain/index.js'), 'utf8');
  assert.match(src, /'claim_proof'/);
  assert.match(src, /STRICT_ONLY_POLICIES = new Set\(\[[^\]]*'claim_proof'/);
  assert.doesNotMatch(src, /MANDATORY_POLICIES = new Set\(\[[^\]]*'claim_proof'/);
});
