'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const HELPER = path.join(REPO, 'tools/HME/hooks/helpers/_check_errors_inline.sh');

test('_hme_check_errors_inline caps huge banners and still emits valid JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-inline-errors-'));
  try {
    fs.mkdirSync(path.join(root, 'log'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tools/HME/runtime'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tools/HME/hooks'), { recursive: true });
    fs.symlinkSync(path.join(REPO, 'tools/HME/hooks/helpers'), path.join(root, 'tools/HME/hooks/helpers'));
    const huge = '[2026-06-01T00:00:00Z] [agent-real] ERROR ' + 'x'.repeat(160000);
    fs.writeFileSync(path.join(root, 'log/hme-errors.log'), huge + '\n');
    fs.writeFileSync(path.join(root, 'tmp/hme-errors.inline-watermark'), '0\n');
    const script = `source '${HELPER}'; _hme_check_errors_inline`;
    const res = spawnSync('bash', ['-c', script], {
      cwd: REPO,
      env: { ...process.env, PROJECT_ROOT: root },
      encoding: 'utf8',
      maxBuffer: 512000,
    });
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.match(parsed.hookSpecificOutput.additionalContext, /truncated/);
    assert.ok(parsed.hookSpecificOutput.additionalContext.length < 13000);
    assert.equal(fs.readFileSync(path.join(root, 'tmp/hme-errors.inline-watermark'), 'utf8').trim(), '1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
