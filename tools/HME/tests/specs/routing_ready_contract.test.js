const { test } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const source = fs.readFileSync(path.join(repo, 'tools/HME/service/server/route_health.py'), 'utf8');

test('routing health makes stale proxy sources actionable', () => {
  assert.match(source, /proxy_stale_sources/);
  assert.match(source, /codex_proxy_stale_sources/);
  assert.match(source, /newer-than-process/);
  assert.match(source, /proxy stale sources/);
  assert.match(source, /codex_proxy stale sources/);
});
