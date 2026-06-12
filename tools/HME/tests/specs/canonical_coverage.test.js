'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const _fs = require('node:fs');
const _os = require('node:os');
const _path = require('node:path');
const { spawnSync } = require('node:child_process');
const { requireEnv } = require('../../proxy/shared/load_env');

const root = requireEnv('PROJECT_ROOT');
const scripts = _path.join(root, 'tools/HME/scripts');

// Run the pure evaluator from verify_coherence.canonical_coverage against an
// explicit (root, entries) pair, returning the issue list. Env is loaded so
function evaluate(evalRoot, entries) {
  const py = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(scripts)})`,
    'from _env_loader import load_env',
    'load_env()',
    'from pathlib import Path',
    'from verify_coherence.canonical_coverage import evaluate_entries',
    'data = json.loads(sys.stdin.read())',
    'print(json.dumps(evaluate_entries(Path(data["root"]), data["entries"])))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', py], {
    input: JSON.stringify({ root: evalRoot, entries }),
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT: root },
  });
  assert.equal(r.status, 0, `evaluator failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

test('real canonical-sources registry is fully gated (no ungated/stale sources)', () => {
  const reg = JSON.parse(_fs.readFileSync(_path.join(root, 'tools/HME/config/canonical-sources.json'), 'utf8'));
  assert.ok(Array.isArray(reg.sources) && reg.sources.length > 0, 'registry must list sources');
  const issues = evaluate(root, reg.sources);
  assert.deepEqual(issues, [], `ungated/stale canonical sources:\n${issues.join('\n')}`);
});

test('registry includes itself as a fixed-point entry', () => {
  const reg = JSON.parse(_fs.readFileSync(_path.join(root, 'tools/HME/config/canonical-sources.json'), 'utf8'));
  assert.ok(
    reg.sources.some((e) => e.source === 'tools/HME/config/canonical-sources.json'),
    'canonical-sources.json must gate itself (fixed point)',
  );
});

test('evaluator flags every coverage-gap class on a synthetic registry', () => {
  const tmp = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'canon-cov-'));
  try {
    _fs.mkdirSync(_path.join(tmp, 'src'), { recursive: true });
    _fs.mkdirSync(_path.join(tmp, 'guards'), { recursive: true });
    // Good pair: source + guard that references the marker.
    _fs.writeFileSync(_path.join(tmp, 'src/canonical.js'), 'module.exports = {};\n');
    _fs.writeFileSync(_path.join(tmp, 'guards/good.test.js'), '// guards canonical.js drift\n');
    // Guard exists but does NOT reference the marker -> stale/non-binding.
    _fs.writeFileSync(_path.join(tmp, 'src/other.js'), 'x\n');
    _fs.writeFileSync(_path.join(tmp, 'guards/stale.test.js'), '// unrelated test\n');
    const entries = [
      { source: 'src/canonical.js', guard: 'guards/good.test.js', marker: 'canonical.js' },
      { source: 'src/missing.js', guard: 'guards/good.test.js', marker: 'canonical.js' },
      { source: 'src/other.js', guard: 'guards/nope.test.js', marker: 'other.js' },
      { source: 'src/other.js', guard: 'guards/stale.test.js', marker: 'other.js' },
    ];
    const issues = evaluate(tmp, entries);
    assert.equal(issues.length, 3, `expected 3 issues, got: ${JSON.stringify(issues)}`);
    assert.ok(issues.some((i) => i.includes('src/missing.js') && i.includes('does not exist')), 'missing source flagged');
    assert.ok(issues.some((i) => i.includes('guards/nope.test.js') && i.includes('does not exist')), 'missing guard flagged');
    assert.ok(issues.some((i) => i.includes('stale.test.js') && i.includes('marker')), 'stale/non-binding guard flagged');
  } finally {
    _fs.rmSync(tmp, { recursive: true, force: true });
  }
});
