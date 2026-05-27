const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

test('hot reload reinitializes file_walker project root', () => {
  const script = `
import os, sys
root = os.environ["PROJECT_ROOT"]
sys.path.insert(0, os.path.join(root, "tools", "HME", "service"))
from server import context as ctx
ctx.PROJECT_ROOT = root
import file_walker
file_walker.init_config(root)
import server.tools_analysis.evolution.evolution_selftest.hot_reload as hot
out = hot.hme_hot_reload("file_walker")
assert "OK file_walker" in out, out
assert file_walker.get_project_root() == root, file_walker.get_project_root()
assert next(file_walker.walk_code_files(), None) is not None
print("ok")
`;
  const res = spawnSync('python3', ['-c', script], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /ok/);
});
