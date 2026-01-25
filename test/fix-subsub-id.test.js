const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('vitest');

test('no NaN or undefined in unit ids produced by treewalker', () => {
  // Run a fast play and treewalker verification
  execSync('cross-env PLAY_LIMIT=1 npm run play:raw', { stdio: 'inherit' });
  execSync('node scripts/test/treewalker.js', { stdio: 'inherit' });
  const reportPath = path.join('output','treewalker-report.json');
  expect(fs.existsSync(reportPath)).toBe(true);
  const report = JSON.parse(fs.readFileSync(reportPath,'utf8'));
  const errors = report.errors || [];
  for (const e of errors) {
    expect(String(e)).not.toMatch(/NaN/);
    expect(String(e)).not.toMatch(/undefined/);
  }
});
