'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withTmpProjectRoot(prefix, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const prior = process.env.PROJECT_ROOT;
  process.env.PROJECT_ROOT = root;
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/tools/HME/proxy/infra/lifecycle_state.js')
        || key.includes('/tools/HME/proxy/shared')
        || key.includes('/tools/HME/proxy/infra/hme_paths.js')) {
      delete require.cache[key];
    }
  }
  try {
    const mod = require('../../proxy/infra/lifecycle_state');
    return fn(root, mod);
  } finally {
    if (prior === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = prior;
    fs.rmSync(root, { recursive: true, force: true });
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/tools/HME/proxy/infra/lifecycle_state.js')
          || key.includes('/tools/HME/proxy/shared')
          || key.includes('/tools/HME/proxy/infra/hme_paths.js')) {
        delete require.cache[key];
      }
    }
  }
}

test('writeJsonAtomic and readJson roundtrip', () => {
  withTmpProjectRoot('lifecycle-state-roundtrip-', (root, lc) => {
    lc.writeJsonAtomic('tools/HME/runtime/sample.json', { hello: 'world' });
    const f = path.join(root, 'tools/HME/runtime/sample.json');
    assert.ok(fs.existsSync(f));
    const back = lc.readJson('tools/HME/runtime/sample.json');
    assert.deepEqual(back, { hello: 'world' });
  });
});

test('readJson returns fallback for missing file', () => {
  withTmpProjectRoot('lifecycle-state-missing-', (_root, lc) => {
    assert.equal(lc.readJson('tools/HME/runtime/nope.json', null), null);
    assert.deepEqual(lc.readJson('tools/HME/runtime/nope.json', { def: 1 }), { def: 1 });
  });
});

test('writeMarker / readMarker / clearMarker for RELOAD_NEEDED uses text payload', () => {
  withTmpProjectRoot('lifecycle-state-marker-', (_root, lc) => {
    lc.writeMarker('RELOAD_NEEDED', 'abc1234');
    assert.equal(lc.readMarker('RELOAD_NEEDED').trim(), 'abc1234');
    assert.equal(lc.clearMarker('RELOAD_NEEDED'), true);
    assert.equal(lc.clearMarker('RELOAD_NEEDED'), false);
  });
});

test('writeMarker for PROXY_RUNTIME accepts json value', () => {
  withTmpProjectRoot('lifecycle-state-runtime-', (_root, lc) => {
    lc.writeMarker('PROXY_RUNTIME', { git_sha: 'abc', pid: 1 });
    const back = lc.readMarker('PROXY_RUNTIME');
    assert.equal(back.git_sha, 'abc');
    assert.equal(back.pid, 1);
  });
});

test('unknown marker throws', () => {
  withTmpProjectRoot('lifecycle-state-unknown-', (_root, lc) => {
    assert.throws(() => lc.readMarker('NOT_A_THING'));
    assert.throws(() => lc.writeMarker('NOT_A_THING', 'x'));
    assert.throws(() => lc.clearMarker('NOT_A_THING'));
  });
});
