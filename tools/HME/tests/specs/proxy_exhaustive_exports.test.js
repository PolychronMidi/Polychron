// Exhaustive: loads every proxy .js module and asserts no export is undefined.
// Runs each require in a short child process so entrypoint-like side effects
// cannot hang the full suite without naming the offender.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROXY_ROOT = path.resolve(__dirname, '..', '..', 'proxy');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Entry-point files that start servers — skip. Relative paths from PROXY_ROOT.
const SKIP_ENTRIES = new Set([
  'hme_proxy.js',
  'codex_proxy.js',
  'middleware_cli.js',
  'shuffler/shuffler.js',
  'shuffler/slot_watchdog.js',
]);

// Files whose require() hangs or spawns workers — skip.
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

function checkModule(rel, full) {
  const script = `
const mod = require(${JSON.stringify(full)});
const failures = [];
if (mod && typeof mod === 'object') {
  for (const [key, val] of Object.entries(mod)) {
    if (val === undefined) failures.push(\`${rel}:\${key} is undefined\`);
  }
}
process.stdout.write(JSON.stringify(failures));
`;
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, PROJECT_ROOT: REPO_ROOT, HME_PROXY_QUIET_IMPORT: '1' },
    encoding: 'utf8',
    timeout: 1500,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return [`${rel}: TIMEOUT while requiring module`];
  if (r.status !== 0) {
    return [`${rel}: ${r.status === null ? 'SIGNAL' : `exit ${r.status}`} — ${(r.stderr || r.stdout || '').trim().slice(0, 500)}`];
  }
  try { return JSON.parse(r.stdout || '[]'); } catch (err) { return [`${rel}: bad checker output — ${err.message}`]; }
}

test('every proxy module export is defined', () => {
  const failures = [];
  for (const { rel, full } of moduleFiles()) {
    failures.push(...checkModule(rel, full));
  }
  assert.equal(failures.length, 0,
    `Modules with undefined exports:\n${failures.join('\n')}`);
});
