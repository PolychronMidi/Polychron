'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stopChain = require('../../proxy/stop_chain');

// Sandbox PROJECT_ROOT for any test that runs the actual chain (which spawns
// bash subprocesses that source _safety.sh and may write to log/hme-errors.log
// via the fail-loud helpers when fed deliberately-malformed payloads).
// Without this, the `runStopChain('not valid json')` test pollutes the
// production hme-errors.log with the parse-error trace, which then surfaces
// in the next real Stop hook's LIFESAVER scan.
function _withChainSandbox(fn) {
  return async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-stop-chain-test-'));
    fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
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

test('stop_chain: runStopChain with empty payload returns shape {stdout, stderr, exit_code}',
  _withChainSandbox(async (chain) => {
    const result = await chain.runStopChain('{}');
    assert.strictEqual(typeof result, 'object');
    assert.strictEqual(typeof result.stdout, 'string');
    assert.strictEqual(typeof result.stderr, 'string');
    assert.strictEqual(typeof result.exit_code, 'number');
    assert.strictEqual(result.exit_code, 0, 'exit_code is always 0 — chain crashes do not wedge agent');
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
