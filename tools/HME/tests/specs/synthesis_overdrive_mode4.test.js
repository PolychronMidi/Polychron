'use strict';
// Legacy overdrive mode 5 is retired as a dispatch mode; registry helpers now back mode 6.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeRedactedEnv } = require('../sandbox_env');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

test('overdrive mode 5 is retired and falls through to cascade', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-od5-retired-'));
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'doc', 'templates'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'doc', 'templates', 'AGENTS.md'), '# sandbox\n');
  fs.copyFileSync(path.join(REPO, 'config', 'models.json'), path.join(sandbox, 'config', 'models.json'));
  writeRedactedEnv(REPO, sandbox, { OVERDRIVE_MODE: '5' });
  try {
    const result = spawnSync('python3', ['-c', `
from server.tools_analysis.synthesis import synthesis_reasoning as sr
import json
overdrive_called = {"flag": False}
def fake_call_opus_overdrive(*a, **kw):
    overdrive_called["flag"] = True
    return ("should-not-fire", "overdrive/retired")
sr._call_opus_overdrive = fake_call_opus_overdrive
def fake_load_providers(): return {}
sr._load_providers = fake_load_providers
sr.call(prompt="test", tier="E5")
print(json.dumps({"called": overdrive_called["flag"], "source": sr.last_source()}))
`], { env: { ...process.env, PROJECT_ROOT: sandbox, PYTHONPATH: path.join(REPO, 'tools', 'HME', 'service') }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.equal(parsed.called, false);
    assert.equal(parsed.source, null);
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
});
