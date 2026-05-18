'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../../hooks/pretooluse/pretooluse_bash.sh');
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function runHook({ cmd, transcriptEntries = [], env = {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noop-petulance-'));
  const transcriptPath = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, transcriptEntries.map((e) => JSON.stringify(e)).join('\n') + (transcriptEntries.length ? '\n' : ''));
  const input = { transcript_path: transcriptPath, tool_input: { command: cmd } };
  try {
    const stdout = execFileSync('bash', [HOOK], {
      input: JSON.stringify(input),
      env: { ...process.env, ...env, PROJECT_ROOT },
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

function noopBashEvent(cmd) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 8)}`, name: 'Bash', input: { command: cmd } }],
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
