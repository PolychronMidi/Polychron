'use strict';
// Regression: OVERDRIVE_MODE=5 reads per-tier model chains from config/models.json
// tiers block (free>subscription>usage by tier_score desc, manually_toprank reordered).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

function _runPython(envOverrides, body) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od5-test-'));
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'CLAUDE.md'), '# sandbox\n');
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

// Expected chains from models.json: cost_order free>subscription>usage, each
// by tier_score desc, then manually_toprank reorder. No claude-* models.
const EXPECTED_CHAINS = {
  E5: ['gpt-5.5-xhigh', 'gpt-5.5-high', 'deepseek-v4-pro-go', 'mimo-v2.5-pro-go', 'deepseek-v4-pro', 'mimo-v2.5-pro', 'gpt-5.2'],
  E4: ['mistral-large-latest', 'gemini-2.5-pro', 'gemini-2.5-pro', 'nemotron-super-49b', 'llama-4-maverick', 'llama-3.3-70b-versatile', 'llama-4-maverick-17b-128e-instruct', 'llama-4-scout-17b-16e-instruct', 'gpt-5.5-medium', 'gpt-5.5-low', 'glm-5.1-go', 'gpt-5.4', 'mimo-v2-pro-go', 'glm-5.1', 'kimi-k2.6', 'minimax-m2.7', 'qwen3.6-plus', 'mimo-v2-pro'],
  E3: ['gpt-4o-mini', 'deepseek-v4-flash', 'mistral-medium-latest', 'gemini-2.5-flash', 'codestral-latest', 'deepseek-chat', 'mistral-large', 'qwen3-32b', 'llama-3.3-70b-instruct', 'glm-5-go', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4-mini', 'mimo-v2.5-go', 'glm-5', 'mimo-v2.5', 'minimax-m2.5', 'gemini-3-flash'],
  E2: ['gemini-2.0-flash', 'gpt-4o-mini', 'nemotron-3-super', 'gemini-2.5-flash', 'nemotron-3-nano-30b-a3b', 'llama-3.2-3b-instruct', 'llama3.1-8b', 'mimo-v2-omni', 'qwen3.5-plus'],
  E1: ['gemini-2.5-flash-lite', 'gemini-2.5-flash-lite', 'big-pickle', 'ring-2.6-1t', 'gpt-5.4-nano'],
};

test('overdrive mode=5: _resolve_mode5_chain returns correct per-tier model lists', () => {
  const result = _runPython({ OVERDRIVE_MODE: '5' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
chains = {}
for tier in ['E5','E4','E3','E2','E1']:
    c = sr._resolve_mode5_chain(tier)
    chains[tier] = list(c) if c else None
print(json.dumps(chains))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  for (const tier of Object.keys(EXPECTED_CHAINS)) {
    assert.deepStrictEqual(
      parsed[tier],
      EXPECTED_CHAINS[tier],
      `${tier} chain mismatch -- expected models in cost/tier_score/toprank order`
    );
  }
});

test('overdrive mode=5: _resolve_mode5_entry returns allow_subagent=False for all tiers', () => {
  const result = _runPython({ OVERDRIVE_MODE: '5' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
entries = {}
for tier in ['E5','E4','E3','E2','E1']:
    e = sr._resolve_mode5_entry(tier)
    if e:
        ch, allow_sub = e
        entries[tier] = {"chain_len": len(ch), "allow_subagent": allow_sub}
    else:
        entries[tier] = None
print(json.dumps(entries))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  for (const tier of ['E5', 'E4', 'E3', 'E2', 'E1']) {
    assert.ok(parsed[tier] !== null, `${tier} must have a non-null chain`);
    assert.strictEqual(parsed[tier].allow_subagent, false,
      `${tier}: allow_subagent=False (no claude-* in registry)`);
  }
});

test('overdrive mode=6: driver uses team_role_models explicit chain', () => {
  const result = _runPython({ OVERDRIVE_MODE: '6', HME_TEAM_ROLE: 'driver' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
entry = sr._resolve_mode6_entry('E3')
chain, allow_sub = entry
print(json.dumps({"chain": list(chain), "allow_subagent": allow_sub}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(parsed.chain, EXPECTED_CHAINS.E5);
  assert.strictEqual(parsed.chain[0], 'gpt-5.5-xhigh');
  assert.strictEqual(parsed.allow_subagent, false);
});

test('overdrive mode=6: purple and crew roles use team_role_models logic', () => {
  const purple = _runPython({ OVERDRIVE_MODE: '6', HME_TEAM_ROLE: 'blue_purple' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
chain, allow_sub = sr._resolve_mode6_entry('E3')
print(json.dumps({"chain": list(chain), "allow_subagent": allow_sub}))
`);
  if (purple.status !== 0) throw new Error(`python failed: ${purple.stderr}`);
  const p = JSON.parse(purple.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(p.chain, EXPECTED_CHAINS.E4);
  assert.strictEqual(p.allow_subagent, false);

  const crew = _runPython({ OVERDRIVE_MODE: '6', HME_TEAM_ROLE: 'crew_e2_1' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
chain, allow_sub = sr._resolve_mode6_entry('E5')
print(json.dumps({"chain": list(chain), "allow_subagent": allow_sub}))
`);
  if (crew.status !== 0) throw new Error(`python failed: ${crew.stderr}`);
  const c = JSON.parse(crew.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(c.chain, EXPECTED_CHAINS.E2);
  assert.strictEqual(c.allow_subagent, false);
});

test('overdrive mode=5: tier=E5 dispatches via registry chain + forces direct API', () => {
  const result = _runPython({ OVERDRIVE_MODE: '5', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True, tier="E3"):
    captured["chain_override"] = chain_override
    captured["allow_subagent"] = allow_subagent
    return ("e5-response", "overdrive/mode5/E5")
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
  assert.deepStrictEqual(parsed.chain_override, EXPECTED_CHAINS.E5,
    'E5 chain must match registry');
  assert.strictEqual(parsed.allow_subagent, false, 'MODE=5 always forces direct API');
  assert.strictEqual(parsed.last_source, 'overdrive/mode5/E5');
});

test('overdrive mode=5: tier=E3 dispatches via registry chain (different tier) + forces direct API', () => {
  const result = _runPython({ OVERDRIVE_MODE: '5', OVERDRIVE_VIA_SUBAGENT: '1' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True, tier="E3"):
    captured["chain_override"] = chain_override
    captured["allow_subagent"] = allow_subagent
    return ("e3-response", "overdrive/mode5/E3")
sr._call_opus_overdrive = fake_call_opus_overdrive
result = sr.call(prompt="test", tier="E3")
print(json.dumps({
  "result": result,
  "chain_override": list(captured.get("chain_override") or []),
  "allow_subagent": captured.get("allow_subagent"),
  "last_source": sr.last_source(),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.result, 'e3-response');
  assert.deepStrictEqual(parsed.chain_override, EXPECTED_CHAINS.E3,
    'E3 chain must match registry');
  assert.strictEqual(parsed.allow_subagent, false, 'MODE=5 always forces direct API');
  assert.strictEqual(parsed.last_source, 'overdrive/mode5/E3');
});

test('overdrive mode=5: tier=E1 dispatches via registry chain + forces direct API', () => {
  const result = _runPython({ OVERDRIVE_MODE: '5', OVERDRIVE_VIA_SUBAGENT: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True, tier="E3"):
    captured["chain_override"] = chain_override
    captured["allow_subagent"] = allow_subagent
    return ("e1-response", "overdrive/mode5/E1")
sr._call_opus_overdrive = fake_call_opus_overdrive
result = sr.call(prompt="test", tier="E1")
print(json.dumps({
  "result": result,
  "chain_override": list(captured.get("chain_override") or []),
  "allow_subagent": captured.get("allow_subagent"),
  "last_source": sr.last_source(),
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.result, 'e1-response');
  assert.deepStrictEqual(parsed.chain_override, EXPECTED_CHAINS.E1,
    'E1 chain must match registry');
  assert.strictEqual(parsed.allow_subagent, false, 'MODE=5 always forces direct API');
  assert.strictEqual(parsed.last_source, 'overdrive/mode5/E1');
});

test('overdrive mode=5: empty tier (models=[]) falls through to free cascade', () => {
  // Empty E1 models before import so _resolve_mode5_chain returns None.
  const result = _runPython({ OVERDRIVE_MODE: '5', OVERDRIVE_VIA_SUBAGENT: '0' }, `
import json, os, re
cfg_path = os.path.join(os.environ["PROJECT_ROOT"], "config", "models.json")
with open(cfg_path) as f:
    raw = f.read()
cfg = json.loads(re.sub(r'^\s*//.*$|[ \t]+//.*$', '', raw, flags=re.MULTILINE))
cfg["tiers"]["E1"]["models"] = []
with open(cfg_path, "w") as f:
    json.dump(cfg, f)

from server.tools_analysis.synthesis import synthesis_reasoning as sr
overdrive_called = {"flag": False}
def fake_call_opus_overdrive(*a, **kw):
    overdrive_called["flag"] = True
    return ("should-not-fire", "overdrive/should-not-fire")
sr._call_opus_overdrive = fake_call_opus_overdrive
def fake_load_providers():
    return {}
sr._load_providers = fake_load_providers
sr.call(prompt="test", tier="E1")
print(json.dumps({
  "overdrive_called": overdrive_called["flag"],
  "chain_is_none": sr._resolve_mode5_chain("E1") is None,
}))
`);
  if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(parsed.chain_is_none, true, 'empty models list => None chain');
  assert.strictEqual(parsed.overdrive_called, false,
    'empty tier must skip overdrive -- cascade fallthrough');
});

// Cascade fallback for empty chains covered by the "empty tier" test above.
// Unknown tiers (e.g. "E6") normalize to E3 via legacy tier map, so they hit overdrive.
