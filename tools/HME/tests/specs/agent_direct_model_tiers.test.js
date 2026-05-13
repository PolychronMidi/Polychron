'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const MODULE = path.join(PROJECT_ROOT, 'tools/HME/service/server/tools_analysis/synthesis/agent_direct.py');

function runPython(body) {
  return spawnSync('python3', ['-c', body], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
    encoding: 'utf8',
  });
}

test('agent_direct maps E1-E5 tiers to Claude CLI model classes', () => {
  const r = runPython(`
import importlib.util, json
spec = importlib.util.spec_from_file_location('agent_direct', ${JSON.stringify(MODULE)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(json.dumps({
  'E1': mod._claude_model_for_tier('E1'),
  'E2': mod._claude_model_for_tier('E2'),
  'E3': mod._claude_model_for_tier('E3'),
  'E4': mod._claude_model_for_tier('E4'),
  'E5': mod._claude_model_for_tier('E5'),
  'hard': mod._claude_model_for_tier('hard'),
}))
`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    E1: 'haiku', E2: 'haiku', E3: 'sonnet', E4: 'opus', E5: 'opus', hard: 'opus',
  });
});

test('agent_direct passes tier-selected model to direct Claude dispatch', () => {
  const r = runPython(`
import importlib.util, json, os, subprocess
spec = importlib.util.spec_from_file_location('agent_direct', ${JSON.stringify(MODULE)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
os.environ['OVERDRIVE_DIRECT_AGENT'] = '1'
class R:
    returncode = 0
    stdout = 'ok'
    stderr = ''
calls = []
def fake_run(cmd, **kwargs):
    calls.append(cmd)
    return R()
subprocess.run = fake_run
mod.dispatch_direct('prompt', 'system', 100, tier='E5')
print(json.dumps(calls[0]))
`);
  assert.equal(r.status, 0, r.stderr);
  const cmd = JSON.parse(r.stdout);
  assert.equal(cmd[cmd.indexOf('--model') + 1], 'opus');
});
