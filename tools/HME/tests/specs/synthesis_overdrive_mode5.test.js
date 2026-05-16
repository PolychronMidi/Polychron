'use strict';
// Active overdrive modes are 0 and 6. Registry-chain helpers remain because mode 6 uses them.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
function run(envOverrides, body) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od6-test-'));
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'doc', 'templates'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'doc', 'templates', 'AGENTS.md'), '# sandbox\n');
  fs.copyFileSync(path.join(REPO, 'config', 'models.json'), path.join(sandbox, 'config', 'models.json'));
  let env = `PROJECT_ROOT=${sandbox}\n`;
  for (const [k, v] of Object.entries(envOverrides)) env += `${k}=${v}\n`;
  fs.writeFileSync(path.join(sandbox, '.env'), env);
  try {
    return spawnSync('python3', ['-c', body], { env: { ...process.env, PROJECT_ROOT: sandbox, PYTHONPATH: path.join(REPO, 'tools', 'HME', 'service') }, encoding: 'utf8' });
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
}

const EXPECTED_E5_HEAD = ['gpt-5.5-xhigh', 'gpt-5.5-high'];
const EXPECTED_E4_HEAD = ['mistral-large-latest', 'gemini-2.5-pro'];
const EXPECTED_E2_HEAD = ['gemini-2.0-flash', 'gpt-4o-mini'];

test('registry helper still resolves tier chains for active mode 6', () => {
  const result = run({ OVERDRIVE_MODE: '6' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
print(json.dumps({
  "E5": list(sr._resolve_mode5_chain("E5")[:2]),
  "E4": list(sr._resolve_mode5_chain("E4")[:2]),
  "E2": list(sr._resolve_mode5_chain("E2")[:2]),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.deepEqual(parsed.E5, EXPECTED_E5_HEAD);
  assert.deepEqual(parsed.E4, EXPECTED_E4_HEAD);
  assert.deepEqual(parsed.E2, EXPECTED_E2_HEAD);
});

test('overdrive mode 6: driver uses team_role_models explicit E5 chain', () => {
  const result = run({ OVERDRIVE_MODE: '6', HME_TEAM_ROLE: 'driver' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
chain, allow_sub = sr._resolve_mode6_entry('E3')
print(json.dumps({"head": list(chain[:2]), "allow_subagent": allow_sub}))
`);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.deepEqual(parsed.head, EXPECTED_E5_HEAD);
  assert.equal(parsed.allow_subagent, false);
});

test('overdrive mode 6: purple and crew roles route by team_role_models', () => {
  const purple = run({ OVERDRIVE_MODE: '6', HME_TEAM_ROLE: 'blue_purple' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
chain, allow_sub = sr._resolve_mode6_entry('E3')
print(json.dumps({"head": list(chain[:2]), "allow_subagent": allow_sub}))
`);
  assert.equal(purple.status, 0, purple.stderr);
  assert.deepEqual(JSON.parse(purple.stdout.trim().split('\n').pop()).head, EXPECTED_E4_HEAD);

  const crew = run({ OVERDRIVE_MODE: '6', HME_TEAM_ROLE: 'crew_e2_1' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
chain, allow_sub = sr._resolve_mode6_entry('E5')
print(json.dumps({"head": list(chain[:2]), "allow_subagent": allow_sub}))
`);
  assert.equal(crew.status, 0, crew.stderr);
  assert.deepEqual(JSON.parse(crew.stdout.trim().split('\n').pop()).head, EXPECTED_E2_HEAD);
});

test('overdrive mode 6 dispatches through registry chain; mode 0 does not', () => {
  const active = run({ OVERDRIVE_MODE: '6', HME_TEAM_ROLE: 'driver' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
captured = {}
def fake_call_opus_overdrive(prompt, system, max_tokens, chain_override=None, allow_subagent=True, tier="E3"):
    captured["head"] = list(chain_override[:2]) if chain_override else None
    captured["allow_subagent"] = allow_subagent
    return ("ok", "overdrive/mode6")
sr._call_opus_overdrive = fake_call_opus_overdrive
print(json.dumps({"result": sr.call(prompt="test", tier="E3"), "captured": captured, "source": sr.last_source()}))
`);
  assert.equal(active.status, 0, active.stderr);
  const a = JSON.parse(active.stdout.trim().split('\n').pop());
  assert.equal(a.result, 'ok');
  assert.deepEqual(a.captured.head, EXPECTED_E5_HEAD);
  assert.equal(a.captured.allow_subagent, false);
  assert.equal(a.source, 'overdrive/mode6');

  const off = run({ OVERDRIVE_MODE: '0' }, `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
called = {"flag": False}
def fake_call_opus_overdrive(*a, **kw):
    called["flag"] = True
    return ("bad", "overdrive/bad")
sr._call_opus_overdrive = fake_call_opus_overdrive
def fake_load_providers(): return {}
sr._load_providers = fake_load_providers
sr.call(prompt="test", tier="E5")
print(json.dumps({"called": called["flag"], "source": sr.last_source()}))
`);
  assert.equal(off.status, 0, off.stderr);
  const o = JSON.parse(off.stdout.trim().split('\n').pop());
  assert.equal(o.called, false);
  assert.equal(o.source, null);
});
