const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
/* global test, expect */

test('no NaN or undefined in unit ids produced by treewalker', () => {
  // Run a fast play and treewalker verification using Node directly (avoid cross-env cli dependency)
  execSync(process.execPath + ' src/play.js', { env: Object.assign({}, process.env, { PLAY_LIMIT: '1', SUPPRESS_HUMAN_MARKER_CHECK: '1' }), stdio: 'inherit' });
  try {
    execSync(process.execPath + ' scripts/test/treewalker.js', { stdio: 'inherit' });
  } catch (e) {
    // scripts/test/treewalker.js exits non-zero on any errors; ignore here so we can parse report and assert on NaN/undefined specifically
  }
  const reportPath = path.join('output','treewalker-report.json');
  expect(fs.existsSync(reportPath)).toBe(true);
  const report = JSON.parse(fs.readFileSync(reportPath,'utf8'));
  const errors = report.errors || [];
  for (const e of errors) {
    expect(String(e)).not.toMatch(/NaN/);
    expect(String(e)).not.toMatch(/undefined/);
  }
});
