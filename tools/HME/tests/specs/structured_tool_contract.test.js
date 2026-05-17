const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const structured = fs.readFileSync(path.join(repo, 'tools/HME/scripts/codex_structured_tool.js'), 'utf8');
const proxy = fs.readFileSync(path.join(repo, 'tools/HME/proxy/hme_proxy.js'), 'utf8');

test('structured Grep accepts whitespace-separated path lists', () => {
  assert.match(structured, /function splitPathList/);
  assert.equal(structured.includes('s.split(/\\s+/).filter(Boolean)'), true);
  assert.match(structured, /paths: d\.paths \|\| splitPathList\(rawPath\)/);
});

test('sub-pipeline upstream failures do not write lifesaver errors', () => {
  assert.match(proxy, /_pathLabel === 'sub-pipeline'/);
  assert.match(proxy, /_suppressLifesaver = _coolingDown \|\| _pathLabel === 'sub-pipeline'/);
  assert.equal(proxy.includes("if (_pathLabel === 'interactive') {\n          const errLog"), true);
});
