'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const ORIGINAL_PATH = process.env.PATH || '';

function sandbox(prefix) {
  const base = path.join(os.tmpdir(), 'hme-test-sandboxes');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, prefix));
  for (const d of ['src', 'tmp', 'log', 'src/output/metrics', 'tools/HME/runtime', '.git', 'bin']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  for (const d of ['scripts', 'config']) fs.symlinkSync(path.join(REPO, d), path.join(root, d));
  const hmeRoot = path.join(root, 'tools/HME');
  for (const ent of fs.readdirSync(path.join(REPO, 'tools/HME'), { withFileTypes: true })) {
    if (ent.name === 'runtime') continue;
    fs.symlinkSync(path.join(REPO, 'tools/HME', ent.name), path.join(hmeRoot, ent.name));
  }
  const fakeGit = path.join(root, 'bin', 'git');
  fs.writeFileSync(fakeGit, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(fakeGit, 0o755);
  fs.writeFileSync(path.join(root, 'tools/HME/runtime/proxy-supervisor.pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(root, 'tools/HME/runtime/universal-pulse-supervisor.pid'), `${process.pid}\n`);
  return root;
}

function fresh(root) {
  process.env.PROJECT_ROOT = root;
  process.env.PATH = path.join(root, 'bin') + path.delimiter + ORIGINAL_PATH;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/tools/HME/event_kernel/') || k.includes('/tools/HME/proxy/shared')) delete require.cache[k];
  }
}

function runNode(args, input, env, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch (_e) { child.kill(sig); } };
    const timer = setTimeout(() => {
      if (done) return;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 500).unref();
      reject(new Error(`node ${args.join(' ')} timed out; stderr=${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('close', (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input || '');
  });
}

test('watchdog turns missing SessionStart completion into a prompt-visible alert', async () => {
  const root = sandbox('hme-watchdog-');
  fresh(root);
  const wd = require('../../event_kernel/hook_watchdog');
  wd.begin(root, 'SessionStart', JSON.stringify({ session_id: 's-watch' }), { host: 'test', clientTimeoutMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const alert = wd.userPromptAlert(root, JSON.stringify({ session_id: 's-watch' }));
  assert.match(alert, /Previous SessionStart likely timed out/);
  assert.match(fs.readFileSync(path.join(root, 'log/hme-errors.log'), 'utf8'), /hook-watchdog/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('watchdog treats later successful hooks as recovered session activity', () => {
  const root = sandbox('hme-watchdog-recovery-');
  fresh(root);
  const wd = require('../../event_kernel/hook_watchdog');
  const tok = wd.begin(root, 'PreToolUse', JSON.stringify({ session_id: 's-recovered' }), { host: 'test' });
  wd.end(tok, { exit_code: 0 });
  assert.strictEqual(wd.userPromptAlert(root, JSON.stringify({ session_id: 's-recovered' })), '');
  const state = wd.readState(root);
  assert.strictEqual(state.activity['s-recovered'].event, 'PreToolUse');
  assert.strictEqual(state.alerted['missing:s-recovered'], undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('watchdog extracts real session id from Anthropic metadata.user_id', () => {
  const wd = require('../../event_kernel/hook_watchdog');
  const payload = {
    metadata: {
      user_id: JSON.stringify({ device_id: 'dev', session_id: 'real-session-id' }),
    },
  };
  assert.strictEqual(wd.sessionId(payload), 'real-session-id');
});

test('codex adapter SessionStart path stays below the client timeout', async () => {
  const root = sandbox('hme-adapter-session-');
  const started = Date.now();
  const res = await runNode(['tools/HME/event_kernel/codex_adapter.js', 'SessionStart'],
    JSON.stringify({ session_id: 's-adapter', cwd: root }),
    {
      PROJECT_ROOT: root,
      CODEX_PROJECT_ROOT: root,
      HME_PROXY_PORT: '9',
      HME_PROXY_ENABLED: '0',
      PATH: path.join(root, 'bin') + path.delimiter + ORIGINAL_PATH,
    });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.ok(Date.now() - started < 8000, `adapter SessionStart too slow: ${Date.now() - started}ms`);
  assert.match(fs.readFileSync(path.join(root, 'tools/HME/runtime/hook-watchdog.jsonl'), 'utf8'), /"phase":"end"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('spawnFileInput timeout kills the hook process group', async () => {
  const root = sandbox('hme-pgroup-');
  fresh(root);
  const { spawnFileInput } = require('../../event_kernel/fs_ipc');
  const script = path.join(root, 'tmp/hangs.sh');
  fs.writeFileSync(script, '#!/usr/bin/env bash\nsleep 30 &\necho $! > "$PROJECT_ROOT/tmp/sleep.pid"\nwait\n');
  fs.chmodSync(script, 0o755);
  const res = await spawnFileInput('bash', [script], { input: '{}', timeoutMs: 1000 });
  assert.strictEqual(res.exit_code, -1);
  const pid = Number(fs.readFileSync(path.join(root, 'tmp/sleep.pid'), 'utf8'));
  for (let i = 0; i < 20; i++) {
    try { process.kill(pid, 0); } catch (_e) { fs.rmSync(root, { recursive: true, force: true }); return; }
    await new Promise((r) => setTimeout(r, 50));
  }
  fs.rmSync(root, { recursive: true, force: true });
  assert.fail(`timed-out hook child still alive: ${pid}`);
});

test('hook lint rejects unsafe raw background operators', () => {
  const bad = [];
  const stack = [path.join(REPO, 'tools/HME/hooks')];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      if (!ent.isFile() || !ent.name.endsWith('.sh')) continue;
      fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, idx) => {
        const s = line.trim();
        const ok = /(_hme_bg|>\s*\/dev\/null|2>|>>|nohup|setsid|<\s*\/dev\/null)/.test(s);
        if (s.endsWith('&') && !s.startsWith('#') && !ok) bad.push(`${path.relative(REPO, full)}:${idx + 1}`);
      });
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('i-wrapper cwd auto-correct is silent on success', () => {
  const res = spawnSync('bash', ['tools/HME/hooks/pretooluse/pretooluse_bash.sh'], {
    cwd: REPO,
    input: JSON.stringify({ tool_input: { command: 'cd tools/HME/scripts && i/status' } }),
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT: REPO },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout, /auto-corrected|systemMessage/);
  const parsed = JSON.parse(res.stdout);
  assert.match(parsed.hookSpecificOutput.updatedInput.command, /\/i\/status$/);
});

test('successful PreToolUse Bash no-op emits no hook budget output', () => {
  const root = sandbox('hme-hook-budget-');
  const res = spawnSync('bash', ['tools/HME/hooks/pretooluse/pretooluse_bash.sh'], {
    cwd: REPO,
    input: JSON.stringify({
      session_id: 'hook-budget-success',
      tool_input: { command: 'true' },
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PROJECT_ROOT: root,
      PATH: path.join(root, 'bin') + path.delimiter + ORIGINAL_PATH,
    },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, '');
  assert.doesNotMatch(res.stderr, /hook \(completed\)|systemMessage/);
  fs.rmSync(root, { recursive: true, force: true });
});
