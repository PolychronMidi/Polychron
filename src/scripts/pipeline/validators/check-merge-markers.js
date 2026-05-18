'use strict';

// Fails the pipeline if any tracked text file still contains unresolved
// git merge-conflict markers from a botched stash/merge. spam-ok
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');

// rationale: ours/separator/theirs marker shapes from git's default conflict style.
const MARKER_RES = [
  { re: /^<{7}\s/m, label: 'ours-marker' }, // spam-ok
  { re: /^={7}$/m, label: 'separator' }, // spam-ok
  { re: /^>{7}\s/m, label: 'theirs-marker' }, // spam-ok
];

// rationale: fixtures/tests/docs intentionally contain marker-looking strings.
const EXCLUDE_PATTERNS = [
  /\.git\//,
  /node_modules\//,
  /\/check-merge-markers\.js$/,
  /\/_fixtures?\//,
  /\/fixtures?\//,
  /\.test\.js$/,
  /\.test\.py$/,
  /\.test\.ts$/,
  /test_.*\.py$/,
  /\.md$/,
];

function trackedTextFiles() {
  const out = execSync('git ls-files -z', { cwd: ROOT, encoding: 'buffer' });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function looksBinary(buf) {
  const len = Math.min(buf.length, 4096);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function main() {
  const files = trackedTextFiles();
  const violations = [];
  for (const rel of files) {
    if (EXCLUDE_PATTERNS.some((p) => p.test(rel))) continue;
    const abs = path.join(ROOT, rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }
    if (looksBinary(buf)) continue;
    const text = buf.toString('utf8');
    const hits = MARKER_RES.filter((m) => m.re.test(text)).map((m) => m.label);
    if (hits.length > 0) violations.push({ rel, hits });
  }
  if (violations.length > 0) {
    for (const v of violations) {
      console.error('  VIOLATION: ' + v.rel + ' -- ' + v.hits.join(','));
    }
    throw new Error('check-merge-markers: ' + violations.length + ' file(s) contain unresolved git conflict markers. Resolve them before committing.');
  }
  console.log('check-merge-markers: PASS (' + files.length + ' tracked file(s) scanned, 0 with markers)');
}

main();
