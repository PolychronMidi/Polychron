'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const script = path.join(repo, 'tools/HME/scripts/audit-comment-bloat.py');

function runOn(file) {
  const env = { ...process.env, PROJECT_ROOT: repo, COMMENT_BLOAT_WARN: '3', COMMENT_BLOAT_FAIL: '5', COMMENT_BLOAT_LONG_LINE: '90' };
  const r = spawnSync('python3', [script, '--json', '--files', file], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('comment-bloat audit counts JS prose block comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-comment-bloat-'));
  try {
    const file = path.join(dir, 'sample.js');
    fs.writeFileSync(file, [
      'const a = 1;',
      '/**',
      ' * prose one',
      ' * prose two',
      ' * prose three',
      ' * prose four',
      ' * prose five',
      ' */',
      '',
    ].join('\n'));
    const d = runOn(file);
    assert.equal(d.fail.length, 1);
    assert.equal(d.fail[0].block_len, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('comment-bloat audit exempts JSDoc type metadata blocks and long type lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-comment-bloat-'));
  try {
    const file = path.join(dir, 'types.js');
    fs.writeFileSync(file, [
      'const a = 1;',
      '/**',
      ' * @typedef {Object} Thing',
      ' * @property {string} extremelyLongPropertyNameForInterfaceMetadata - this is type metadata and should not be prose bloat even when long',
      ' * @property {number} size - metadata',
      ' * @property {boolean} ready - metadata',
      ' * @property {string} other - metadata',
      ' */',
      '',
    ].join('\n'));
    const d = runOn(file);
    assert.equal(d.fail.length, 0);
    assert.equal(d.long_lines.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
