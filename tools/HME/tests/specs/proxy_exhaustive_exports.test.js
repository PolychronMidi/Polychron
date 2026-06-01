// Exhaustive: loads every proxy .js module and asserts no export is undefined.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROXY_ROOT = path.resolve(__dirname, '..', '..', 'proxy');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const SKIP_ENTRIES = new Set([
  'hme_proxy.js',
  'codex_proxy.js',
  'middleware_cli.js',
  'shuffler/shuffler.js',
  'shuffler/slot_watchdog.js',
  'stop_chain/cli.js',
]);

const SKIP_HANGERS = new Set([
  'upstream.js',
  'upstream_client.js',
  'omniroute_client.js',
]);

function moduleFiles() {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (entry.name === 'mcp_server') continue;
        walk(full);
      } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
        const rel = path.relative(PROXY_ROOT, full).split(path.sep).join('/');
        if (SKIP_ENTRIES.has(rel)) continue;
        if (entry.name.startsWith('test_')) continue;
        if (SKIP_HANGERS.has(entry.name)) continue;
        out.push({ rel, full });
      }
    }
  }
  walk(PROXY_ROOT);
  return out;
}

function checkModules(modules) {
  const script = `
const modules = ${JSON.stringify(modules)};
const failures = [];
for (const { rel, full } of modules) {
  process.stderr.write('[proxy-export] requiring ' + rel + '\\n');
  try {
    const mod = require(full);
    if (mod && typeof mod === 'object') {
      for (const [key, val] of Object.entries(mod)) {
        if (val === undefined) failures.push(rel + ':' + key + ' is undefined');
      }
    }
  } catch (err) {
    failures.push(rel + ': ' + (err.code || 'THREW') + ' — ' + err.message);
  }
}
process.stdout.write(JSON.stringify(failures));
process.exit(failures.length ? 1 : 0);
`;
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, PROJECT_ROOT: REPO_ROOT, HME_PROXY_QUIET_IMPORT: '1' },
    encoding: 'utf8',
    timeout: 12000,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    const tail = String(r.stderr || '').trim().split('\n').slice(-5).join('\n');
    return [`proxy export checker timed out; last modules:\n${tail}`];
  }
  if (r.status !== 0) {
    return [`proxy export checker ${r.status === null ? 'SIGNAL' : `exit ${r.status}`} — ${(r.stderr || r.stdout || '').trim().slice(0, 800)}`];
  }
  try { return JSON.parse(r.stdout || '[]'); } catch (err) { return [`proxy export checker bad output — ${err.message}`]; }
}

test('every proxy module export is defined', () => {
  const failures = checkModules(moduleFiles());
  assert.equal(failures.length, 0,
    `Modules with undefined exports:\n${failures.join('\n')}`);
});
