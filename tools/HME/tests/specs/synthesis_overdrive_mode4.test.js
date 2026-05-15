'use strict';
// Regression: OVERDRIVE_MODE=4 routes E3->deepseek-flash, E4->deepseek-pro, E5->glm-5.1.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

function _runPython(envOverrides, body) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od4-test-'));
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'AGENTS.md'), '# sandbox\n');
  fs.copyFileSync(path.join(REPO, 'config', 'models.json'), path.join(sandbox, 'config', 'models.json'));
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

test('overdrive mode=4: tier=E5 pins glm-5.1 + forces direct API', () => {
  const result = _runPython({ OVERDRIVE_MODE: '4', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True, tier="E3"):
    captured["chain_override"] = chain_override
    captured["allow_subagent"] = allow_subagent
    return ("e5-response", "overdrive/zen/glm-5.1")
sr._call_opus_overdrive = fake_call_opus_overdrive
result = sr.call(prompt="test", tier="E5")
print(json.dumps({
  "result": result,
  "chain_override": list(captured.get("chain_override") or []),
  "allow_subagent": captured.get("allow_subagent"),
  "last_source": sr.last_source(),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.result, 'e5-response');
  assert.deepStrictEqual(parsed.chain_override, ['glm-5.1'], 'E5 pins glm-5.1');
  assert.strictEqual(parsed.allow_subagent, false, 'E5 forces direct API in MODE=4 (subagent cant pin non-Anthropic model)');
  assert.strictEqual(parsed.last_source, 'overdrive/zen/glm-5.1');
});

test('overdrive mode=4: tier=E4 pins deepseek-v4-pro', () => {
  const result = _runPython({ OVERDRIVE_MODE: '4', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True, tier="E3"):
    captured["chain_override"] = chain_override
    captured["allow_subagent"] = allow_subagent
    return ("e4-response", "overdrive/zen/deepseek-pro")
sr._call_opus_overdrive = fake_call_opus_overdrive
result = sr.call(prompt="test", tier="E4")
print(json.dumps({
  "chain_override": list(captured.get("chain_override") or []),
  "allow_subagent": captured.get("allow_subagent"),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(parsed.chain_override, ['deepseek-v4-pro']);
  assert.strictEqual(parsed.allow_subagent, false);
});

test('overdrive mode=4: tier=E3 pins deepseek-v4-flash', () => {
  const result = _runPython({ OVERDRIVE_MODE: '4', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True, tier="E3"):
    captured["chain_override"] = chain_override
    return ("e3-response", "overdrive/zen/deepseek-flash")
sr._call_opus_overdrive = fake_call_opus_overdrive
sr.call(prompt="test", tier="E3")
print(json.dumps({"chain_override": list(captured.get("chain_override") or [])}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(parsed.chain_override, ['deepseek-v4-flash']);
});

test('overdrive mode=4: tier=E1/E2 skip overdrive (cascade fallthrough)', () => {
  for (const tier of ['E1', 'E2']) {
    const result = _runPython({ OVERDRIVE_MODE: '4', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
overdrive_called = {"flag": False}
def fake_call_opus_overdrive(*a, **kw):
    overdrive_called["flag"] = True
    return ("should-not-fire", "overdrive/should-not-fire")
sr._call_opus_overdrive = fake_call_opus_overdrive
def fake_load_providers():
    return {}
sr._load_providers = fake_load_providers
sr.call(prompt="test", tier="${tier}")
print(json.dumps({"overdrive_called": overdrive_called["flag"]}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.overdrive_called, false, `${tier} must skip overdrive in MODE=4`);
  }
});
