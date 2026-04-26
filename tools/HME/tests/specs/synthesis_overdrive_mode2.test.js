'use strict';
// Regression tests for OVERDRIVE_MODE=2 tier-aware routing in
// synthesis_reasoning. Verifies the dispatch decisions WITHOUT actually
// hitting any model — we mock the leaf functions and check which path
// the call() entry-point chose for each tier.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

function _runPython(envOverrides, body) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od2-test-'));
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'CLAUDE.md'), '# sandbox\n');
  // Build .env from real one with selective overrides
  let env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
  env = env.replace(/^PROJECT_ROOT=.*$/m, `PROJECT_ROOT=${sandbox}`);
  env = env.replace(/^([A-Z_]+_(TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL))=.*$/gm, '$1=REDACTED');
  for (const [k, v] of Object.entries(envOverrides)) {
    if (env.match(new RegExp(`^${k}=`, 'm'))) {
      env = env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
    } else {
      env += `\n${k}=${v}\n`;
    }
  }
  fs.writeFileSync(path.join(sandbox, '.env'), env);
  try {
    const result = spawnSync('python3', ['-c', body], {
      env: {
        ...process.env,
        PROJECT_ROOT: sandbox,
        PYTHONPATH: path.join(REPO, 'tools', 'HME', 'service'),
      },
      encoding: 'utf8',
    });
    return result;
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
}

test('overdrive mode=2: tier=hard routes through full Opus chain', () => {
  const result = _runPython({ OVERDRIVE_MODE: '2', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True):
    captured["chain_override"] = chain_override
    captured["allow_subagent"] = allow_subagent
    return ("hard-response", "overdrive/opus")
sr._call_opus_overdrive = fake_call_opus_overdrive
result = sr.call(prompt="test", tier="hard")
print(json.dumps({
  "result": result,
  "chain_override": captured.get("chain_override"),
  "allow_subagent": captured.get("allow_subagent"),
  "last_source": sr.last_source(),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.result, 'hard-response');
  assert.strictEqual(parsed.chain_override, null, 'hard tier uses default chain (Opus→Sonnet)');
  assert.strictEqual(parsed.allow_subagent, true, 'hard tier permits subagent dispatch');
  assert.strictEqual(parsed.last_source, 'overdrive/opus');
});

test('overdrive mode=2: tier=medium pins Sonnet-only chain + forces direct API', () => {
  const result = _runPython({ OVERDRIVE_MODE: '2', OVERDRIVE_VIA_SUBAGENT: '1' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True):
    captured["chain_override"] = chain_override
    captured["allow_subagent"] = allow_subagent
    return ("medium-response", "overdrive/sonnet")
sr._call_opus_overdrive = fake_call_opus_overdrive
result = sr.call(prompt="test", tier="medium")
print(json.dumps({
  "result": result,
  "chain_override": list(captured.get("chain_override") or []),
  "allow_subagent": captured.get("allow_subagent"),
  "last_source": sr.last_source(),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.result, 'medium-response');
  assert.deepStrictEqual(parsed.chain_override, ['claude-sonnet-4-6'], 'medium tier pins Sonnet chain');
  assert.strictEqual(parsed.allow_subagent, false, 'medium tier forces direct API (subagent cant pin model)');
  assert.strictEqual(parsed.last_source, 'overdrive/sonnet');
});

test('overdrive mode=2: tier=easy skips overdrive entirely and falls through to cascade', () => {
  const result = _runPython({ OVERDRIVE_MODE: '2', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
overdrive_called = {"flag": False}
def fake_call_opus_overdrive(*a, **kw):
    overdrive_called["flag"] = True
    return ("should-not-be-used", "overdrive/should-not-fire")
sr._call_opus_overdrive = fake_call_opus_overdrive
# Stub the cascade so we can detect it was reached
def fake_load_providers():
    return {}
sr._load_providers = fake_load_providers
result = sr.call(prompt="test", tier="easy")
print(json.dumps({
  "result": result,
  "overdrive_called": overdrive_called["flag"],
  "last_source": sr.last_source(),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.overdrive_called, false, 'easy tier must NOT call overdrive — cascade only');
  // result is None because we stubbed the cascade with no providers; the
  // important assertion is that overdrive was skipped, not what cascade returned.
});

test('overdrive mode=1: tier parameter ignored (Opus chain regardless of tier)', () => {
  const result = _runPython({ OVERDRIVE_MODE: '1', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {"calls": []}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True):
    captured["calls"].append({"chain_override": chain_override, "allow_subagent": allow_subagent})
    return ("response", "overdrive/opus")
sr._call_opus_overdrive = fake_call_opus_overdrive
sr.call(prompt="test", tier="easy")
sr.call(prompt="test", tier="medium")
sr.call(prompt="test", tier="hard")
print(json.dumps({
  "all_default_chain": all(c["chain_override"] is None for c in captured["calls"]),
  "all_allow_subagent": all(c["allow_subagent"] is True for c in captured["calls"]),
  "call_count": len(captured["calls"]),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.call_count, 3, 'mode=1 fires overdrive for every tier');
  assert.strictEqual(parsed.all_default_chain, true, 'mode=1 uses default chain regardless of tier');
  assert.strictEqual(parsed.all_allow_subagent, true, 'mode=1 permits subagent regardless of tier');
});

test('overdrive mode=0: no overdrive call at all', () => {
  const result = _runPython({ OVERDRIVE_MODE: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
overdrive_called = {"flag": False}
def fake_call_opus_overdrive(*a, **kw):
    overdrive_called["flag"] = True
    return ("nope", "overdrive/should-not-fire")
sr._call_opus_overdrive = fake_call_opus_overdrive
def fake_load_providers():
    return {}
sr._load_providers = fake_load_providers
sr.call(prompt="test", tier="hard")
print(json.dumps({"overdrive_called": overdrive_called["flag"]}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.overdrive_called, false, 'mode=0 must NEVER call overdrive');
});
