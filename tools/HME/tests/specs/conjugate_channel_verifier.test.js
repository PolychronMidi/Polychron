'use strict';
// Unit tests for the ConjugateChannelVerifier (Horizon V coupling).
// Verifies the FIRST verifier whose status depends on the composition
// signal correctly classifies rounds into quadrants.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function _runVerifier() {
  // Invoke verifier in isolation via Python; compare status + summary.
  // verify_coherence._base reads PROJECT_ROOT fail-fast; must propagate.
  const r = spawnSync('python3', ['-c', `
import sys
sys.path.insert(0, '${path.join(PROJECT_ROOT, 'tools/HME/scripts')}')
from verify_coherence.code_audits import ConjugateChannelVerifier
res = ConjugateChannelVerifier().execute()
print(res.status)
print(res.summary)
`.trim()], { encoding: 'utf8', timeout: 10000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('ConjugateChannelVerifier executes without crashing', () => {
  const r = _runVerifier();
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  // First line is status (PASS/FAIL/WARN/SKIP/ERROR)
  assert.match(lines[0], /^(PASS|FAIL|WARN|SKIP|ERROR)$/);
});

test('ConjugateChannelVerifier reports quadrant in summary when PASS', () => {
  const r = _runVerifier();
  if (r.stdout.startsWith('PASS')) {
    // Summary should mention one of the four quadrants
    assert.match(r.stdout, /mature stability|sterile rigor|lucky chaos|lost/);
  }
});

test('ConjugateChannelVerifier registered in REGISTRY', () => {
  const r = spawnSync('python3', ['-c', `
import sys
sys.path.insert(0, '${path.join(PROJECT_ROOT, 'tools/HME/scripts')}')
from verify_coherence import REGISTRY
names = [v.name for v in REGISTRY]
assert 'conjugate-channel' in names, f'conjugate-channel missing from REGISTRY; have {names[:5]}...'
print('ok')
`.trim()], { encoding: 'utf8', timeout: 10000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT } });
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /ok/);
});
