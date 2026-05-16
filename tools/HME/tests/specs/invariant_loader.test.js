'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function sandbox(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function py(args) {
  return spawnSync('python3', args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT, METRICS_DIR: path.join(PROJECT_ROOT, 'output', 'metrics'), PYTHONPATH: path.join(PROJECT_ROOT, 'tools/HME/service') },
    encoding: 'utf8',
  });
}

test('invariant loader merges index includes in order', () => {
  const root = sandbox('inv-load-');
  const index = path.join(root, 'invariants.json');
  fs.mkdirSync(path.join(root, 'shards'));
  fs.writeFileSync(index, JSON.stringify({ _include: ['shards/a.json', 'shards/b.json'], invariants: [{ id: 'root', type: 'file_exists' }] }));
  fs.writeFileSync(path.join(root, 'shards', 'a.json'), JSON.stringify({ invariants: [{ id: 'a', type: 'json_valid' }] }));
  fs.writeFileSync(path.join(root, 'shards', 'b.json'), JSON.stringify({ invariants: [{ id: 'b', type: 'glob_count_gte' }] }));
  const r = py(['-c', `
import importlib.util, json
spec=importlib.util.spec_from_file_location('base', ${JSON.stringify(path.join(PROJECT_ROOT, 'tools/HME/service/server/tools_analysis/evolution/evolution_invariants/_base.py'))})
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
data=mod._merge_config(${JSON.stringify(index)})
print(json.dumps([i['id'] for i in data['invariants']]))
`]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['root', 'a', 'b']);
});

test('invariant config validator catches duplicate ids and unknown types in merged shards', () => {
  const root = sandbox('inv-bad-');
  const index = path.join(root, 'invariants.json');
  const dispatch = path.join(root, 'dispatch.py');
  fs.mkdirSync(path.join(root, 'shards'));
  fs.writeFileSync(index, JSON.stringify({ _types: { file_exists: '' }, _include: ['shards/a.json'], invariants: [{ id: 'dup', type: 'file_exists' }] }));
  fs.writeFileSync(path.join(root, 'shards', 'a.json'), JSON.stringify({ invariants: [{ id: 'dup', type: 'made_up' }] }));
  fs.writeFileSync(dispatch, 'checkers = {"file_exists": _check_file_exists}\n');
  const r = py(['tools/HME/scripts/invariants/check_invariant_config.py', '--config', index, '--dispatch', dispatch]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /duplicate invariant id: dup/);
  assert.match(r.stdout, /invariant type used but unsupported: made_up/);
  assert.match(r.stdout, /invariant type used but undocumented: made_up/);
});
