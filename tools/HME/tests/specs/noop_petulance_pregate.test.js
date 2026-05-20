'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../../hooks/pretooluse/pretooluse_bash.sh');
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function runHook({ cmd, transcriptEntries = [], env = {}, statePath = '', transcriptPathOverride }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noop-petulance-'));
  const transcriptPath = transcriptPathOverride === undefined ? path.join(tmp, 'transcript.jsonl') : transcriptPathOverride;
  if (transcriptPath) fs.writeFileSync(transcriptPath, transcriptEntries.map((e) => JSON.stringify(e)).join('\n') + (transcriptEntries.length ? '\n' : ''));
  const input = { transcript_path: transcriptPath, tool_name: 'Bash', tool_input: { command: cmd } };
  try {
    const stdout = execFileSync('bash', [HOOK], {
      input: JSON.stringify(input),
      env: { ...process.env, HME_PETULANCE_STATE_PATH: statePath || path.join(tmp, 'petulance-state.json'), ...env, PROJECT_ROOT },
      encoding: 'utf8',
    });
    return { stdout, ok: true };
  } catch (err) {
    return { stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || '', code: err.status, ok: false };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function userMsg() {
  return { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'turn-start sentinel' }] } };
}

function bashEvent(cmd, extra = {}) {
  return {
    type: 'assistant',
    ...extra,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 8)}`, name: 'Bash', input: { command: cmd } }],
    },
  };
}

function noopBashEvent(cmd) {
  return bashEvent(cmd);
}

function editEvent() {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 8)}`, name: 'Edit', input: { file_path: 'test-fixture.txt', old_string: 'a', new_string: 'b' } }],
    },
  };
}

test('petulance pregate allows a first no-op Bash this turn', () => {
  const out = runHook({ cmd: ':', transcriptEntries: [userMsg()] });
  assert.strictEqual(out.ok, true, 'gate must not block first no-op');
  assert.ok(!out.stdout.includes('SPIRALLING_PETULANCE'), 'no block message emitted');
});

test('petulance pregate denies the 2nd no-op Bash this turn', () => {
  const out = runHook({
    cmd: ':',
    transcriptEntries: [userMsg(), noopBashEvent(':')],
  });
  assert.ok(out.stdout.includes('SPIRALLING_PETULANCE'), `expected deny, got: ${out.stdout}`);
  assert.match(out.stdout, /"permissionDecision":\s*"deny"/, 'deny verdict present');
});

test('petulance pregate allows real commands even after a prior no-op', () => {
  const out = runHook({
    cmd: 'ls -la',
    transcriptEntries: [userMsg(), noopBashEvent(':')],
  });
  assert.ok(out.ok, 'real command must not be blocked');
  assert.ok(!out.stdout.includes('SPIRALLING_PETULANCE'), 'no petulance verdict for real command');
});

test('petulance pregate override HME_PETULANCE_OK=1 bypasses the gate', () => {
  const out = runHook({
    cmd: ':',
    transcriptEntries: [userMsg(), noopBashEvent(':')],
    env: { HME_PETULANCE_OK: '1' },
  });
  assert.ok(!out.stdout.includes('SPIRALLING_PETULANCE'), 'override must bypass');
});

test('petulance pregate matches `true`, empty printf, empty echo variants', () => {
  for (const cmd of ['true', "printf ''", "echo ''", '  :  ']) {
    const out = runHook({
      cmd,
      transcriptEntries: [userMsg(), noopBashEvent(':')],
    });
    assert.ok(out.stdout.includes('SPIRALLING_PETULANCE'), `expected deny for cmd='${cmd}', got: ${out.stdout}`);
  }
});

test('petulance pregate denies repeated real Bash command within 3 minutes without edit', () => {
  const cmd = 'i/hme admin action=health';
  const out = runHook({
    cmd,
    transcriptEntries: [userMsg(), bashEvent(cmd)],
  });
  assert.ok(out.stdout.includes('SPIRALLING_PETULANCE'), `expected repeat deny, got: ${out.stdout}`);
  assert.match(out.stdout, /within 3 minutes with no intervening edit/);
});

test('petulance pregate state tracker denies repeated command without transcript dependency', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petulance-state-'));
  const statePath = path.join(stateDir, 'state.json');
  try {
    const cmd = 'state-only-repeat-command';
    const first = runHook({ cmd, transcriptEntries: [userMsg()], statePath });
    assert.ok(first.ok, `first state-backed command should pass, got: ${first.stdout}`);
    const second = runHook({ cmd, transcriptEntries: [userMsg()], statePath });
    assert.ok(second.stdout.includes('[SPIRALLING_PETULANCE]'), `expected state-backed deny, got: ${second.stdout}`);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('petulance pregate state tracker denies repeated command when transcript is missing', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petulance-missing-transcript-'));
  const statePath = path.join(stateDir, 'state.json');
  try {
    const cmd = 'i/status mode=activity';
    const first = runHook({ cmd, statePath, transcriptPathOverride: '' });
    assert.ok(first.ok, `first command should pass without transcript, got: ${first.stdout}`);
    const second = runHook({ cmd, statePath, transcriptPathOverride: '' });
    assert.ok(second.stdout.includes('[SPIRALLING_PETULANCE]'), `expected state-backed deny without transcript, got: ${second.stdout}`);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('petulance pregate state reset allows repeated command after edit reset', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petulance-state-reset-'));
  const statePath = path.join(stateDir, 'state.json');
  try {
    const cmd = 'state-reset-repeat-command';
    assert.ok(runHook({ cmd, transcriptEntries: [userMsg()], statePath }).ok);
    execFileSync('python3', [path.join(PROJECT_ROOT, 'tools/HME/scripts/detectors/spiralling_petulance.py'), '--reset-edit'], {
      env: { ...process.env, PROJECT_ROOT, HME_PETULANCE_STATE_PATH: statePath },
      encoding: 'utf8',
    });
    const out = runHook({ cmd, transcriptEntries: [userMsg()], statePath });
    assert.ok(out.ok, `expected allow after state reset, got: ${out.stdout}`);
    assert.ok(!out.stdout.includes('SPIRALLING_PETULANCE'), 'state reset must clear repeat chain');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('petulance pregate allows repeated command after an edit tool', () => {
  const cmd = 'i/hme admin action=health';
  const out = runHook({
    cmd,
    transcriptEntries: [userMsg(), bashEvent(cmd), editEvent()],
  });
  assert.ok(out.ok, `expected allow after edit, got: ${out.stdout}`);
  assert.ok(!out.stdout.includes('SPIRALLING_PETULANCE'), 'edit must reset repeat chain');
});

test('petulance pregate allows repeated command outside 3 minute window', () => {
  const cmd = 'i/hme admin action=health';
  const out = runHook({
    cmd,
    transcriptEntries: [userMsg(), bashEvent(cmd, { ts: 1 })],
  });
  assert.ok(out.ok, `expected allow for stale repeat, got: ${out.stdout}`);
  assert.ok(!out.stdout.includes('SPIRALLING_PETULANCE'), 'stale command must not block');
});

test('petulance pregate escalates repeated command to level 3 all-caps message', () => {
  const cmd = 'i/hme admin action=health';
  const out = runHook({
    cmd,
    transcriptEntries: [userMsg(), bashEvent(cmd), bashEvent(cmd), bashEvent(cmd)],
  });
  assert.ok(out.stdout.includes('[SPIRALLING_PETULANCE:L3]'), `expected level 3, got: ${out.stdout}`);
  assert.ok(out.stdout.includes('CASTING OUT THE DEVIL FOR PATHETIC DDOS COWARDICE'), `expected level 3 exorcism text, got: ${out.stdout}`);
});
