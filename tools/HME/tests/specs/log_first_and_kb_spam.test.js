'use strict';
// Regression tests for the two new pretooluse_bash sub-hooks:
//   - bash/log_first.sh -- block re-running lint/tc when log is fresh and
//     no source has changed.
//   - bash/kb_spam.sh -- block i/learn invocations with title="Feedback:..."
//
// Both shipped in response to a real user correction: the agent re-ran
// `npm run test:hme` three times to grep different parts of the same
// output, and saved a "Feedback:" memo into the KB instead of converting
// the rule into a hook. The hooks make those classes of waste impossible
// rather than relying on the agent to remember.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const LOG_FIRST = path.join(REPO, 'tools', 'HME', 'hooks', 'pretooluse', 'bash', 'log_first.sh');
const KB_SPAM = path.join(REPO, 'tools', 'HME', 'hooks', 'pretooluse', 'bash', 'kb_spam.sh');

// _safety.sh re-asserts `set -euo pipefail` and resolves PROJECT_ROOT from the
// real project -- sourcing it under a tmp PROJECT_ROOT crashes the harness.
// The sub-hooks we test only use _emit_block from safety, so stub it directly.
function runSubhook(subhookPath, cmd, projectRoot = REPO) {
  const script = `
set +u +e
_emit_block() { printf 'BLOCK: %s\\n' "$1" >&2; }
export PROJECT_ROOT='${projectRoot}'
export CMD='${cmd.replace(/'/g, `'\\''`)}'
source '${subhookPath}'
echo "EXIT_CODE=$?"
`;
  try {
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    // silent-ok: optional fallback path.
    return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
}

test('log_first.sh: file exists and is executable', () => {
  assert.ok(fs.existsSync(LOG_FIRST));
  const stat = fs.statSync(LOG_FIRST);
  assert.ok(stat.mode & 0o111, 'must be executable');
});

test('kb_spam.sh: file exists and is executable', () => {
  assert.ok(fs.existsSync(KB_SPAM));
  const stat = fs.statSync(KB_SPAM);
  assert.ok(stat.mode & 0o111, 'must be executable');
});

test('log_first.sh: blocks "npm run lint" when log/lint.log is fresher than all source', () => {
  // Build a tiny isolated project root with a fresh log and stale "code".
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'log_first-'));
  fs.mkdirSync(path.join(tmp, 'log'));
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.mkdirSync(path.join(tmp, 'tools', 'HME'), { recursive: true });
  // Stale code (1 hour ago)
  const stalePath = path.join(tmp, 'src', 'old.js');
  fs.writeFileSync(stalePath, '// old');
  const oldTime = (Date.now() / 1000) - 3600;
  fs.utimesSync(stalePath, oldTime, oldTime);
  // Fresh log (now)
  fs.writeFileSync(path.join(tmp, 'log', 'lint.log'), 'lint output');
  const r = runSubhook(LOG_FIRST, 'npm run lint', tmp);
  assert.strictEqual(r.ok, false, 'should exit non-zero');
  assert.strictEqual(r.code, 2, 'should exit 2');
  assert.match(r.out, /BLOCKED: log\/lint\.log/);
  assert.match(r.out, /Read the existing log/);
});

test('log_first.sh: allows "npm run lint" when source is newer than log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'log_first-'));
  fs.mkdirSync(path.join(tmp, 'log'));
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.mkdirSync(path.join(tmp, 'tools', 'HME'), { recursive: true });
  // Old log
  const logPath = path.join(tmp, 'log', 'lint.log');
  fs.writeFileSync(logPath, 'lint output');
  const oldTime = (Date.now() / 1000) - 3600;
  fs.utimesSync(logPath, oldTime, oldTime);
  // Fresh code
  fs.writeFileSync(path.join(tmp, 'src', 'fresh.js'), '// new');
  const r = runSubhook(LOG_FIRST, 'npm run lint', tmp);
  assert.strictEqual(r.ok, true, `should exit 0; got: ${r.out}`);
});

test('log_first.sh: does not block unrelated bash commands', () => {
  const r = runSubhook(LOG_FIRST, 'ls -la');
  assert.strictEqual(r.ok, true);
});

test('kb_spam.sh: blocks i/learn with double-quoted Feedback: title', () => {
  const r = runSubhook(KB_SPAM, 'i/learn title="Feedback: do X" content=y category=decision');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /BLOCKED: KB titles starting with 'Feedback:'/);
});

test('kb_spam.sh: blocks i/learn with single-quoted Feedback: title', () => {
  const r = runSubhook(KB_SPAM, `i/learn title='Feedback: do X' content=y`);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 2);
});

test('kb_spam.sh: blocks i/learn with unquoted Feedback: title', () => {
  const r = runSubhook(KB_SPAM, 'i/learn title=Feedback:foo content=y');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 2);
});

test('kb_spam.sh: allows i/learn with non-Feedback title', () => {
  const r = runSubhook(KB_SPAM, 'i/learn title="Drum kit rotator pattern" content=y category=pattern');
  assert.strictEqual(r.ok, true, `should pass; got: ${r.out}`);
});

test('kb_spam.sh: does NOT false-positive when Feedback: appears only inside content', () => {
  const r = runSubhook(KB_SPAM, 'i/learn title="real title" content="user said Feedback: was wrong"');
  assert.strictEqual(r.ok, true, `content-only Feedback: must not trigger; got: ${r.out}`);
});

test('kb_spam.sh: ignores commands that are not i/learn', () => {
  const r = runSubhook(KB_SPAM, 'ls -la');
  assert.strictEqual(r.ok, true);
});
