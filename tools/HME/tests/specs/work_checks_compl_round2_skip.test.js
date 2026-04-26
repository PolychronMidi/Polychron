'use strict';
// Regression tests for the round-2 auto-completeness skip — when the
// assistant's response to round 1 was already "Nothing missed" /
// "Confirmed nothing remains", round 2 is pure context burn and must
// NOT fire.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const POLICIES_DIR = path.join(REPO, 'tools', 'HME', 'proxy', 'stop_chain', 'policies');
const PROXY_DIR = path.join(REPO, 'tools', 'HME', 'proxy');

function _withSandbox(fn) {
  return async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-compl-test-'));
    fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
    const prev = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = sandbox;
    // Bust caches under proxy/ so PROJECT_ROOT-bound modules reload
    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(PROXY_DIR)) delete require.cache[k];
    }
    try {
      await fn(sandbox);
    } finally {
      if (prev === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = prev;
      for (const k of Object.keys(require.cache)) {
        if (k.startsWith(PROXY_DIR)) delete require.cache[k];
      }
      try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    }
  };
}

function _writeTranscript(sandbox, entries) {
  const transcriptPath = path.join(sandbox, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return transcriptPath;
}

function _ctxStub(sandbox, transcriptPath) {
  const denied = { value: null };
  const allowed = { value: false };
  return {
    payload: { transcript_path: transcriptPath },
    deny: (reason) => { denied.value = reason; return { decision: 'deny', reason }; },
    allow: () => { allowed.value = true; return { decision: 'allow', message: null }; },
    instruct: (m) => ({ decision: 'instruct', message: m }),
    _denied: denied,
    _allowed: allowed,
  };
}

test('compl-round2-skip: round 2 is suppressed when round-1 response was "Nothing missed."',
  _withSandbox(async (sandbox) => {
    const transcript = _writeTranscript(sandbox, [
      { type: 'user', message: { content: 'do the thing' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Did the thing.' }] } },
      { type: 'user', message: { content: 'AUTO-COMPLETENESS INJECT (round 1/2): ...' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Nothing missed.' }] } },
    ]);
    const policy = require(path.join(POLICIES_DIR, 'work_checks.js'));
    // Pre-seed the COMPL counter to 1 (round 1 already fired) so this run
    // is the round-2 decision point.
    const compl = path.join(sandbox, 'tmp', 'hme-completeness-injected.json');
    // The dedup key includes a hash of (turnIndex, prompt-text). Easier to
    // first invoke the policy once to advance the counter to 1, then a
    // second invocation simulates the round-2 firing.
    const ctx1 = _ctxStub(sandbox, transcript);
    await policy.run(ctx1);
    // Counter should now be 1 (round 1 deny fired)
    const after1 = JSON.parse(fs.readFileSync(compl, 'utf8'));
    const counterValues = Object.values(after1);
    assert.strictEqual(counterValues.length, 1, 'one counter slot');
    assert.strictEqual(counterValues[0], 1, 'round 1 advanced counter to 1');
    // Now simulate round-2 trigger: assistant's MOST RECENT message in the
    // transcript is already "Nothing missed." → skip should fire
    const ctx2 = _ctxStub(sandbox, transcript);
    const result = await policy.run(ctx2);
    assert.strictEqual(result.decision, 'allow', 'round 2 must NOT deny when round-1 was nothing-missed');
    const after2 = JSON.parse(fs.readFileSync(compl, 'utf8'));
    assert.strictEqual(Object.values(after2)[0], 2, 'counter advanced to MAX (budget spent)');
  }));

test('compl-round2-skip: round 2 STILL fires when round-1 response was substantive (not nothing-missed)',
  _withSandbox(async (sandbox) => {
    const transcript = _writeTranscript(sandbox, [
      { type: 'user', message: { content: 'do the thing' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Did some.' }] } },
      { type: 'user', message: { content: 'AUTO-COMPLETENESS INJECT (round 1/2): ...' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'I found three more items: A, B, C. Implementing now. (long substantive response that mentions nothing missed nowhere)' }] } },
    ]);
    const policy = require(path.join(POLICIES_DIR, 'work_checks.js'));
    const ctx1 = _ctxStub(sandbox, transcript);
    await policy.run(ctx1);
    const ctx2 = _ctxStub(sandbox, transcript);
    const result = await policy.run(ctx2);
    assert.strictEqual(result.decision, 'deny', 'substantive response → round 2 still fires');
    assert.ok(result.reason.includes('round 2/2'), 'round 2 deny reason');
  }));

test('compl-round2-skip: long response containing "nothing missed" mid-sentence does NOT trigger skip',
  _withSandbox(async (sandbox) => {
    const longResponse =
      'I made the change to the dispatcher. Verified nothing missed in ' +
      'the test suite. Then I refactored the helper, cleaned up three ' +
      'callers, and updated the docstring with the rationale.';
    const transcript = _writeTranscript(sandbox, [
      { type: 'user', message: { content: 'do the thing' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Started.' }] } },
      { type: 'user', message: { content: 'AUTO-COMPLETENESS INJECT (round 1/2): ...' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: longResponse }] } },
    ]);
    const policy = require(path.join(POLICIES_DIR, 'work_checks.js'));
    const ctx1 = _ctxStub(sandbox, transcript);
    await policy.run(ctx1);
    const ctx2 = _ctxStub(sandbox, transcript);
    const result = await policy.run(ctx2);
    assert.strictEqual(result.decision, 'deny', 'long response → round 2 still fires (length gate prevents false skip)');
  }));
