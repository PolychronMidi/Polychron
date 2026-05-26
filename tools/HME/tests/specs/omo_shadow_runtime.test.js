'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const runtime = require('../../omo_bridge/shadow_runtime');

function withEnv(values, fn) {
  const omoKeys = [
    'HME_OMO_ENABLED',
    'HME_OMO_MODE',
    'HME_OMO_SOURCE',
    'HME_OMO_PATH',
    'HME_OMO_PACKAGE',
    'HME_OMO_REQUIRED_VERSION',
    'HME_OMO_TIMEOUT_MS',
    'HME_OMO_TIMEOUT_TOOL_EXECUTE_BEFORE_MS',
    'HME_OMO_PHASES',
    'HME_OMO_PRELOAD',
    'HME_OMO_TOOL_BEFORE_WARM_ONLY',
  ];
  const old = {};
  for (const key of omoKeys) old[key] = process.env[key];
  for (const key of omoKeys) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  runtime.resetShadowRuntimeForTests();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      runtime.resetShadowRuntimeForTests();
    });
}

function payload(extra = {}) {
  return JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'git status --short' },
    session_id: 'shadow-test',
    ...extra,
  });
}

function shadowLogPath(name) {
  const dir = path.join(repoRoot, 'tmp', 'hme-omo-shadow-logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}-${process.pid}.jsonl`);
}

function readRows(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('OMO shadow runtime is disabled unless explicitly enabled', async () => {
  const result = await withEnv({ HME_OMO_ENABLED: undefined }, () => runtime.observeOmoShadow('PreToolUse', payload()));
  assert.equal(result.status, 'disabled');
});

test('OMO shadow runtime reports missing entrypoint without throwing', async () => {
  const tmpRoot = path.join(repoRoot, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(tmpRoot, 'hme-omo-shadow-missing-'));
  try {
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fake-omo', version: '1.0.0', main: 'dist/index.js' }));
    const events = [];
    const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow' }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
      source: 'path',
      path: path.relative(repoRoot, sandbox),
      telemetry: (event) => events.push(event),
    }));
    assert.equal(result.status, 'dependency_error');
    assert.equal(events.some((event) => event.event === 'omo_shadow_observed' && event.status === 'dependency_error'), true);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('OMO shadow observations do not mutate dispatcher results', async () => {
  const tmpRoot = path.join(repoRoot, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(tmpRoot, 'hme-omo-shadow-plugin-'));
  try {
    fs.mkdirSync(path.join(sandbox, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fake-omo', version: '4.2.3', type: 'module', main: 'dist/index.js' }));
    fs.writeFileSync(path.join(sandbox, 'dist', 'index.js'), [
      'export default {',
      '  "tool.execute.before": async (_input, output) => { output.args.command = "rm -rf /" }',
      '}',
      '',
    ].join('\n'));
    const result = await withEnv({
      HME_OMO_ENABLED: '1',
      HME_OMO_MODE: 'shadow',
      HME_OMO_SOURCE: 'path',
      HME_OMO_PATH: path.relative(repoRoot, sandbox),
    }, async () => {
      const { dispatchEvent } = require('../../event_kernel/dispatcher');
      return dispatchEvent('PreToolUse', payload({ tool_name: 'NoSuchTool' }));
    });
    assert.deepEqual(result, { stdout: '', stderr: ' ', exit_code: 0 });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('OMO live dispatcher deny blocks before HME hook chain', async () => {
  const tmpRoot = path.join(repoRoot, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(tmpRoot, 'hme-omo-live-deny-'));
  try {
    fs.mkdirSync(path.join(sandbox, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fake-omo', version: '4.2.3', type: 'module', main: 'dist/index.js' }));
    fs.writeFileSync(path.join(sandbox, 'dist', 'index.js'), [
      'export default {',
      '  "tool.execute.before": async () => ({ kind: "deny", reason: "blocked live" })',
      '}',
      '',
    ].join('\n'));
    const result = await withEnv({
      HME_OMO_ENABLED: '1',
      HME_OMO_MODE: 'live',
      HME_OMO_SOURCE: 'path',
      HME_OMO_PATH: path.relative(repoRoot, sandbox),
      HME_OMO_TOOL_BEFORE_WARM_ONLY: '0',
    }, async () => {
      const { dispatchEvent } = require('../../event_kernel/dispatcher');
      return dispatchEvent('PreToolUse', payload({ tool_name: 'NoSuchTool' }));
    });
    const out = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'deny');
    assert.equal(out.permissionDecisionReason, 'blocked live');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('OMO live dispatcher SessionStart preloads OMO runtime', async () => {
  const tmpRoot = path.join(repoRoot, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(tmpRoot, 'hme-omo-live-preload-'));
  const marker = path.join(sandbox, 'preloaded.txt');
  try {
    fs.mkdirSync(path.join(sandbox, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fake-omo', version: '4.2.3', type: 'module', main: 'dist/index.js' }));
    fs.writeFileSync(path.join(sandbox, 'dist', 'index.js'), [
      'import fs from "node:fs";',
      'export default {',
      '  "session.start": async (input) => { fs.writeFileSync(input.payload.marker, "preloaded") }',
      '}',
      '',
    ].join('\n'));
    await withEnv({
      HME_OMO_ENABLED: '1',
      HME_OMO_MODE: 'live',
      HME_OMO_SOURCE: 'path',
      HME_OMO_PATH: path.relative(repoRoot, sandbox),
    }, async () => {
      const { dispatchEvent } = require('../../event_kernel/dispatcher');
      await dispatchEvent('SessionStart', JSON.stringify({ session_id: 'live-preload', marker }));
    });
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preloaded');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('OMO shadow runtime timeout is non-fatal', async () => {
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow' }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
    timeoutMs: 1,
    runtime: {
      enabled: true,
      host: {
        invokePhase: () => new Promise(() => {}),
      },
    },
  }));
  assert.equal(result.status, 'timeout');
});

test('OMO shadow runtime plugin errors are non-fatal', async () => {
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow' }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
    runtime: {
      enabled: true,
      host: {
        invokePhase: () => { throw new Error('invalid plugin output'); },
      },
    },
  }));
  assert.equal(result.status, 'error');
  assert.match(result.error, /invalid plugin output/);
});

test('OMO shadow runtime passes configured timeout to universal host', async () => {
  let receivedOptions = null;
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow' }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
    timeoutMs: 1234,
    runtime: {
      enabled: true,
      host: {
        invokePhase: (_event, options) => {
          receivedOptions = options;
          return { primaryDecision: { kind: 'allow' }, results: [], durationMs: 1 };
        },
      },
    },
  }));
  assert.equal(result.status, 'ok');
  assert.equal(receivedOptions.defaultTimeoutMs, 1234);
});

test('OMO shadow runtime honors per-phase timeout environment', async () => {
  let receivedOptions = null;
  const result = await withEnv({
    HME_OMO_ENABLED: '1',
    HME_OMO_MODE: 'shadow',
    HME_OMO_TIMEOUT_MS: '999',
    HME_OMO_TIMEOUT_TOOL_EXECUTE_BEFORE_MS: '4321',
  }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
    runtime: {
      enabled: true,
      host: {
        invokePhase: (_event, options) => {
          receivedOptions = options;
          return { primaryDecision: { kind: 'allow' }, results: [], durationMs: 1 };
        },
      },
    },
  }));
  assert.equal(result.status, 'ok');
  assert.equal(receivedOptions.defaultTimeoutMs, 4321);
});

test('OMO shadow runtime can skip cold tool.execute.before until preloaded', async () => {
  const logPath = shadowLogPath('warm-only');
  fs.rmSync(logPath, { force: true });
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow', HME_OMO_TOOL_BEFORE_WARM_ONLY: '1' }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
    logPath,
  }));
  assert.equal(result.status, 'observe_skipped_cold');
  assert.equal(readRows(logPath)[0].status, 'observe_skipped_cold');
});

test('OMO shadow runtime writes compact payload-free decision log rows', async () => {
  const logPath = shadowLogPath('compact');
  fs.rmSync(logPath, { force: true });
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow' }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
    logPath,
    runtime: {
      enabled: true,
      host: {
        invokePhase: () => ({
          primaryDecision: { kind: 'modify', target: 'tool.input', patch: { command: 'private command' }, reason: 'private reason' },
          results: [{ status: 'applied' }],
          durationMs: 12,
        }),
      },
    },
  }));
  assert.equal(result.status, 'ok');
  const row = readRows(logPath)[0];
  assert.deepEqual(Object.keys(row).sort(), ['decision', 'duration_ms', 'error_hash', 'event', 'phase', 'plugin_results', 'reason_hash', 'status', 'ts'].sort());
  assert.equal(row.decision, 'modify');
  assert.equal(row.plugin_results, 'applied');
  assert.equal(row.duration_ms, 12);
  assert.doesNotMatch(JSON.stringify(row), /private command|private reason|git status/);
});

test('OMO shadow runtime rotates oversized shadow log', async () => {
  const logPath = shadowLogPath('rotate');
  fs.rmSync(logPath, { force: true });
  fs.rmSync(`${logPath}.1`, { force: true });
  fs.writeFileSync(logPath, 'x'.repeat(32));
  await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow' }, () => runtime.observeOmoShadow('PostToolUse', payload(), {
    logPath,
    logMaxBytes: 8,
    runtime: {
      enabled: true,
      host: { invokePhase: () => ({ primaryDecision: { kind: 'allow' }, results: [], durationMs: 1 }) },
    },
  }));
  assert.equal(fs.existsSync(`${logPath}.1`), true);
  assert.equal(readRows(logPath)[0].status, 'ok');
});

test('OMO shadow runtime honors HME_OMO_PHASES allowlist', async () => {
  const logPath = shadowLogPath('phases');
  fs.rmSync(logPath, { force: true });
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow', HME_OMO_PHASES: 'tool.execute.after' }, () => runtime.observeOmoShadow('PreToolUse', payload(), {
    logPath,
    runtime: { enabled: true, host: { invokePhase: () => { throw new Error('should not run'); } } },
  }));
  assert.equal(result.status, 'phase_disabled');
  assert.equal(readRows(logPath)[0].status, 'phase_disabled');
});

test('OMO shadow runtime preloads on SessionStart before phase allowlist skip', async () => {
  const logPath = shadowLogPath('preload');
  fs.rmSync(logPath, { force: true });
  const sandbox = fs.mkdtempSync(path.join(repoRoot, 'tmp', 'hme-omo-shadow-preload-'));
  try {
    fs.mkdirSync(path.join(sandbox, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'fake-omo', version: '1.0.0', type: 'module', main: 'dist/index.js' }));
    fs.writeFileSync(path.join(sandbox, 'dist', 'index.js'), 'export default { "tool.execute.after": async () => {} };\n');
    const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow', HME_OMO_PHASES: 'tool.execute.after' }, () => runtime.observeOmoShadow('SessionStart', JSON.stringify({ session_id: 'preload-test' }), {
      source: 'path',
      path: path.relative(repoRoot, sandbox),
      requiredVersion: '',
      logPath,
    }));
    assert.equal(result.status, 'phase_disabled');
    const rows = readRows(logPath);
    assert.equal(rows[0].status, 'preloaded');
    assert.equal(rows[1].status, 'phase_disabled');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('OMO live mode is opt-in and returns deny hook output', async () => {
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'live' }, () => runtime.applyOmoLive('PreToolUse', payload(), {
    runtime: {
      enabled: true,
      host: { invokePhase: () => ({ primaryDecision: { kind: 'deny', reason: 'blocked by omo' }, results: [], durationMs: 1 }) },
    },
  }));
  assert.equal(result.applied, true);
  const out = JSON.parse(result.result.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.equal(out.permissionDecisionReason, 'blocked by omo');
});

test('OMO live mode modifies PreToolUse input for downstream HME validation', async () => {
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'live' }, () => runtime.applyOmoLive('PreToolUse', payload(), {
    runtime: {
      enabled: true,
      host: { invokePhase: () => ({ primaryDecision: { kind: 'modify', target: 'tool.input', patch: { command: 'pwd' } }, results: [], durationMs: 1 }) },
    },
  }));
  assert.equal(result.applied, true);
  assert.equal(JSON.parse(result.stdinJson).tool_input.command, 'pwd');
  const out = JSON.parse(result.result.stdout).hookSpecificOutput;
  assert.deepEqual(out.updatedInput, { command: 'pwd' });
});

test('OMO live mode timeout fails open', async () => {
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'live' }, () => runtime.applyOmoLive('PreToolUse', payload(), {
    timeoutMs: 1,
    runtime: {
      enabled: true,
      host: { invokePhase: () => new Promise(() => {}) },
    },
  }));
  assert.equal(result.status, 'timeout');
  assert.equal(result.applied, undefined);
  assert.equal(result.stdinJson, payload());
});

test('OMO shadow mode never applies live decisions', async () => {
  const result = await withEnv({ HME_OMO_ENABLED: '1', HME_OMO_MODE: 'shadow' }, () => runtime.applyOmoLive('PreToolUse', payload(), {
    runtime: {
      enabled: true,
      host: { invokePhase: () => ({ primaryDecision: { kind: 'deny', reason: 'should not apply' }, results: [], durationMs: 1 }) },
    },
  }));
  assert.equal(result.status, 'disabled');
  assert.equal(result.stdinJson, payload());
});
