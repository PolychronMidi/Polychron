'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

// Regression suite for the 9 bg analytics scripts that had the missing
// METRICS_DIR definition silently failing under main-pipeline's
// `stdio: 'ignore'` bg-spawn. Each script is invoked with a short
// timeout; we assert exit 0 and no `NameError` / `Traceback` in stderr.
//
// Why this matters: those scripts are the substrate the HCI coherence-
// registry, dashboard, and trajectory predictions all depend on. A silent
// regression here makes the whole observability layer go stale without
// the pipeline showing a verdict change. Surfacing the bug at test time
// closes the loop the original silent-spawn antipattern left open.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HME_SCRIPTS = path.join(REPO_ROOT, 'tools', 'HME', 'scripts');

const SCRIPTS = [
  'snapshot-holograph.py',
  'analyze-tool-effectiveness.py',
  'analyze-hci-trajectory.py',
  'build-dashboard.py',
  'predict-hci.py',
  'suggest-verifiers.py',
  'promote-global-kb.py',
  'memetic-drift.py',
  'emit-hci-signal.py',
];

for (const script of SCRIPTS) {
  test(`bg-script: ${script} runs without NameError or Traceback`, () => {
    const file = path.join(HME_SCRIPTS, script);
    let stderr = '';
    let code = 0;
    try {
      execFileSync('python3', [file], {
        env: { ...process.env, PROJECT_ROOT: REPO_ROOT },
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // execFileSync throws on non-zero exit; capture status + stderr.
      code = err.status || -1;
      stderr = err.stderr ? err.stderr.toString('utf8') : '';
    }
    assert.strictEqual(code, 0, `${script} exited ${code}; stderr:\n${stderr.slice(0, 600)}`);
    assert.ok(!stderr.includes('NameError'), `${script} stderr contained NameError:\n${stderr.slice(0, 400)}`);
    assert.ok(!stderr.includes('Traceback'), `${script} stderr contained Traceback:\n${stderr.slice(0, 400)}`);
  });
}
