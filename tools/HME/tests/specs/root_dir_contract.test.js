const { test } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const checker = path.join(repo, 'src/scripts/pipeline/validators/check-root-only-dirs.js');

function withRoot(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'root-contract-'));
  try { return fn(tmp); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function run(root) {
  return childProcess.spawnSync('node', [checker], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT: root },
  });
}

test('root-dir contract allows only canonical metrics roots', () => withRoot((root) => {
  fs.mkdirSync(path.join(root, 'log'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/output/metrics'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools/HME/runtime/metrics'), { recursive: true });
  assert.equal(run(root).status, 0);
  fs.mkdirSync(path.join(root, 'metrics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'metrics/bad.json'), '{}
');
  assert.notEqual(run(root).status, 0);
}));

test('root-dir contract rejects nested tmp but allows HME metrics files', () => withRoot((root) => {
  fs.mkdirSync(path.join(root, 'tools/HME/runtime/metrics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/runtime/metrics/hme-ok.json'), '{}
');
  assert.equal(run(root).status, 0);
  fs.mkdirSync(path.join(root, 'tools/HME/runtime/tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/HME/runtime/tmp/nope.txt'), 'x');
  assert.notEqual(run(root).status, 0);
}));
