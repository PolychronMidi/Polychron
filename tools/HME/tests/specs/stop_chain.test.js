'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const stopChain = require('../../proxy/stop_chain');

// Sandbox PROJECT_ROOT for any test that runs the actual chain (which spawns
// bash subprocesses that source _safety.sh and may write to log/hme-errors.log
// via the fail-loud helpers when fed deliberately-malformed payloads).
// Without this, the `runStopChain('not valid json')` test pollutes the
// production hme-errors.log with the parse-error trace, which then surfaces
// in the next real Stop hook's LIFESAVER scan.
async function _withMockedStopPolicies(overrides, fn) {
  const originalLoad = Module._load;
  const originalRoot = process.env.PROJECT_ROOT;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-stop-chain-mock-'));
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'runtime', 'metrics'), { recursive: true });
  process.env.PROJECT_ROOT = sandbox;
  const proxyDir = path.resolve(__dirname, '..', '..', 'proxy');
  const telemetryDir = path.resolve(__dirname, '..', '..', 'telemetry');
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(proxyDir) || k.startsWith(telemetryDir)) delete require.cache[k];
  }
  Module._load = function mockedLoad(request, parent, isMain) {
    if (String(request).includes(`${path.sep}stop_chain${path.sep}policies${path.sep}`)) {
      const name = path.basename(String(request), '.js');
      if (Object.prototype.hasOwnProperty.call(overrides, name)) {
        const value = overrides[name];
        if (value instanceof Error) throw value;
        return value;
      }
      return { name, run: async (ctx) => ctx.allow() };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    const chain = require('../../proxy/stop_chain');
    await fn(chain, sandbox);
  } finally {
    Module._load = originalLoad;
    if (originalRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = originalRoot;
    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(proxyDir) || k.startsWith(telemetryDir)) delete require.cache[k];
    }
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
}

function _withChainSandbox(fn) {
  return async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-stop-chain-test-'));
    fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'runtime', 'metrics'), { recursive: true });
    const original = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = sandbox;
    // Bust the require cache for any module that captured PROJECT_ROOT at load
    // time (proxy/shared.js, stop_chain/index.js, stop_chain/shell_policy.js,
    // every policy module, and the unified policy registry). Re-loading after
    // the env override yields a stop_chain rooted at the sandbox.
    const proxyDir = path.resolve(__dirname, '..', '..', 'proxy');
    const policiesDir = path.resolve(__dirname, '..', '..', 'policies');
    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(proxyDir) || k.startsWith(policiesDir)) {
        delete require.cache[k];
      }
    }
    const sandboxedChain = require('../../proxy/stop_chain');
    try {
      await fn(sandboxedChain, sandbox);
    } finally {
      if (original === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = original;
      // Clear cache again so subsequent tests in the same process see the
      // production root.
      for (const k of Object.keys(require.cache)) {
        if (k.startsWith(proxyDir) || k.startsWith(policiesDir)) {
          delete require.cache[k];
        }
      }
      try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
    }
  };
}

test('stop_chain: exports the decision contract', () => {
  assert.strictEqual(typeof stopChain.runStopChain, 'function');
  assert.strictEqual(typeof stopChain.deny, 'function');
  assert.strictEqual(typeof stopChain.instruct, 'function');
  assert.strictEqual(typeof stopChain.allow, 'function');
});

test('stop_chain: deny shape', () => {
  assert.deepStrictEqual(stopChain.deny('reason text'), { decision: 'deny', reason: 'reason text' });
});

test('stop_chain: allow with optional message', () => {
  assert.deepStrictEqual(stopChain.allow(), { decision: 'allow', message: null });
  assert.deepStrictEqual(stopChain.allow('hi'), { decision: 'allow', message: 'hi' });
});

test('stop_chain: instruct shape', () => {
  assert.deepStrictEqual(stopChain.instruct('continue'), { decision: 'instruct', message: 'continue' });
});

test('stop_chain: mandatory work_checks exception fails closed', async () => {
  await _withMockedStopPolicies({
    work_checks: { name: 'work_checks', run: async () => { throw new Error('synthetic work-check crash'); } },
  }, async (chain) => {
    const result = await chain.runStopChain('{}');
    const decision = JSON.parse(result.stdout);
    assert.strictEqual(decision.decision, 'block');
    assert.match(decision.reason, /STOP-CHAIN INTEGRITY FAILURE/);
    assert.match(decision.reason, /work_checks/);
    assert.match(decision.reason, /synthetic work-check crash/);
  });
});

test('stop_chain: mandatory detectors load failure fails closed', async () => {
  await _withMockedStopPolicies({
    detectors: new Error('synthetic detector load crash'),
  }, async (chain) => {
    const result = await chain.runStopChain('{}');
    const decision = JSON.parse(result.stdout);
    assert.strictEqual(decision.decision, 'block');
    assert.match(decision.reason, /STOP-CHAIN INTEGRITY FAILURE/);
    assert.match(decision.reason, /detectors/);
    assert.match(decision.reason, /synthetic detector load crash/);
  });
});

test('stop_chain: optional post_hooks exception still fails open', async () => {
  await _withMockedStopPolicies({
    post_hooks: { name: 'post_hooks', run: async () => { throw new Error('synthetic optional crash'); } },
  }, async (chain) => {
    const result = await chain.runStopChain('{}');
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /synthetic optional crash/);
  });
});

test('stop_chain: runStopChain with empty payload returns shape {stdout, stderr, exit_code}',
  _withChainSandbox(async (chain) => {
    const result = await chain.runStopChain('{}');
    assert.strictEqual(typeof result, 'object');
    assert.strictEqual(typeof result.stdout, 'string');
    assert.strictEqual(typeof result.stderr, 'string');
    assert.strictEqual(typeof result.exit_code, 'number');
    assert.strictEqual(result.exit_code, 0, 'exit_code is always 0 -- chain crashes do not wedge agent');
  }));

test('stop_chain: subagent escape short-circuits when _hme_subagent: true',
  _withChainSandbox(async (chain) => {
    const result = await chain.runStopChain(JSON.stringify({ _hme_subagent: true }));
    assert.strictEqual(result.stdout, '', 'subagent escape returns empty stdout (no deny, no instruct)');
    assert.strictEqual(result.stderr, '');
    assert.strictEqual(result.exit_code, 0);
  }));

test('stop_chain: runStopChain handles malformed JSON without throwing',
  _withChainSandbox(async (chain, sandbox) => {
    const result = await chain.runStopChain('not valid json');
    assert.strictEqual(result.exit_code, 0);
    assert.strictEqual(typeof result.stdout, 'string');
    // Sanity: the production errors.log was NOT touched. The sandbox's own
    // errors.log may legitimately gain entries (that's expected fail-loud
    // behavior); we only need the prod log to stay clean.
    const prodErrLog = path.join(__dirname, '..', '..', '..', '..', 'log', 'hme-errors.log');
    if (fs.existsSync(prodErrLog)) {
      const tail = fs.readFileSync(prodErrLog, 'utf8').split('\n').slice(-20).join('\n');
      // No fresh _safe_jq parse-error entries from this turn (sandbox is a
      // fresh tmp dir; if a parse error landed in prod log it'd be from us).
      const sandboxBaseName = path.basename(sandbox);
      assert.ok(
        !tail.includes(sandboxBaseName),
        'fail-loud parse errors must not leak into production log/hme-errors.log',
      );
    }
  }));


test('nexus_pending: summary verdict overrides stale FAILED marker',
  _withChainSandbox(async (chain, sandbox) => {
    fs.mkdirSync(path.join(sandbox, 'src', 'output', 'metrics'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sandbox, 'tmp', 'hme-nexus.state'),
      'PIPELINE:1:FAILED\nCOMMIT:2:ok\n',
    );
    fs.writeFileSync(
      path.join(sandbox, 'src', 'output', 'metrics', 'pipeline-summary.json'),
      JSON.stringify({ verdict: 'STABLE', failed: 5 }) + '\n',
    );
    const policy = require('../../proxy/stop_chain/policies/nexus_pending');
    const result = await policy.run(chain);
    assert.strictEqual(result.decision, 'allow');
  }));
