const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const structured = fs.readFileSync(path.join(repo, 'tools/HME/scripts/codex_structured_tool.js'), 'utf8');
const proxy = fs.readFileSync(path.join(repo, 'tools/HME/proxy/hme_proxy.js'), 'utf8')
  + fs.readFileSync(path.join(repo, 'tools/HME/proxy/hme_proxy_claude.js'), 'utf8');

test('structured Grep accepts whitespace-separated path lists', () => {
  assert.match(structured, /function splitPathList/);
  assert.equal(structured.includes('s.split(/\\s+/).filter(Boolean)'), true);
  assert.match(structured, /paths: d\.paths \|\| splitPathList\(rawPath\)/);
});

test('structured Grep skips missing path-list entries without aborting valid roots', () => {
  assert.match(structured, /const bases = \[\]/);
  assert.match(structured, /skipped\.push\(String\(p\)\)/);
  assert.match(structured, /Error: no valid grep path\(s\)/);
});

test('sub-pipeline upstream failures do not write lifesaver errors', () => {
  assert.match(proxy, /_pathLabel === 'sub-pipeline'/);
  assert.match(proxy, /_suppressLifesaver = _coolingDown \|\| _pathLabel === 'sub-pipeline'/);
  assert.equal(proxy.includes("if (_pathLabel === 'interactive') {\n          const errLog"), true);
});

test('structured path parsing strips accidental trailing punctuation after miss', () => {
  assert.match(structured, /function pathCandidates/);
  assert.match(structured, /replace\(\/\^\['/);
});
