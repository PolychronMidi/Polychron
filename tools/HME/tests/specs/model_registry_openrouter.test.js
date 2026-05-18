const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

test('model registry uses canonical OpenRouter free routes', () => {
  const script = path.join(ROOT, 'tools/HME/scripts/verify-model-registry.py');
  const result = spawnSync('python3', [script], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /model_registry=ok/);
});
