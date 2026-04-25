'use strict';

// Enforces canonical locations: log/ and tmp/ at project root; metrics/ at output/metrics/.
// Any instance elsewhere indicates a path bug writing runtime output to a non-standard location.

const fs   = require('fs');
const path = require('path');
const { ROOT } = require('../hme/utils');
const { execSync } = require('child_process');

// log/ and tmp/ must be at root only. metrics/ is special: allowed only at output/metrics/.
const ROOT_ONLY_NAMES = new Set(['log', 'tmp']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '__pycache__']);

function walk(dir, violations) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (ROOT_ONLY_NAMES.has(entry.name)) {
      violations.push(full);
      // Don't descend -- the whole subtree is the violation
    } else if (entry.name === 'metrics') {
      // metrics/ is allowed only at output/metrics/; flag any other location
      const rel = path.relative(ROOT, full);
      if (rel !== path.join('output', 'metrics')) {
        violations.push(full);
      }
    } else {
      walk(full, violations);
    }
  }
}

// Returns the set of paths that are staged for deletion (D in index column).
// These are in-progress fixes -- don't flag them.
function getStagedDeletions() {
  try {
    const out = execSync('git status --porcelain', { cwd: ROOT, stdio: 'pipe' }).toString();
    const deletions = new Set();
    for (const line of out.split('\n')) {
      if (line.startsWith('D ') || line.startsWith('D ')) {
        deletions.add(line.slice(3).trim());
      }
    }
    return deletions;
  } catch {
    return new Set();
  }
}

// A directory is safe ONLY IF it is physically empty (or contains only
// gitignored AND zero-content). Previously this function treated any
// gitignored content as safe, which let .gitignore become a silencer:
// add `/metrics` to .gitignore -> verifier counts it as "safe gitignored"
// -> writers keep accumulating files there indefinitely. The invariant
// is about PATH CORRECTNESS, not about git accounting. So we now check
// for actual files on disk: any non-empty file inside a misplaced log/
// tmp/ metrics/ directory IS a violation regardless of git status. Only
// staged-for-deletion files (fix in progress) are exempt.
function isSafe(absPath, stagedDeletions) {
  const rel = path.relative(ROOT, absPath);

  // Walk the directory contents directly. Any file that exists on disk
  // and isn't currently staged for deletion is evidence of an active
  // path bug. Directory existence with files -> violation.
  function hasLiveFiles(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return false; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (hasLiveFiles(full)) return true;
        continue;
      }
      const fileRel = path.relative(ROOT, full);
      if (stagedDeletions.has(fileRel)) continue;
      return true;
    }
    return false;
  }

  return !hasLiveFiles(absPath);
}

function main() {
  const violations = [];
  let entries;
  try { entries = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (e) {
    throw new Error('check-root-only-dirs: cannot read project root: ' + e.message);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (ROOT_ONLY_NAMES.has(entry.name)) continue; // root-level log/ and tmp/ allowed
    // metrics/ at root level is now a violation (moved to output/metrics/)
    if (entry.name === 'metrics') { violations.push(path.join(ROOT, entry.name)); continue; }
    walk(path.join(ROOT, entry.name), violations);
  }

  const stagedDeletions = getStagedDeletions();
  const unsafe = violations.filter(v => !isSafe(v, stagedDeletions));

  if (unsafe.length > 0) {
    for (const v of unsafe) {
      console.error('  VIOLATION: ' + path.relative(ROOT, v) + ' -- must not exist outside project root');
    }
    throw new Error(
      'check-root-only-dirs: ' + unsafe.length + ' misplaced log/metrics/tmp director' +
      (unsafe.length === 1 ? 'y' : 'ies') + ' found with live content. ' +
      'log/ and tmp/ must be at project root; metrics/ must be at output/metrics/. ' +
      'Add gitignore entries for any runtime-only paths.'
    );
  }

  const empty = violations.length - unsafe.length;
  console.log(
    'check-root-only-dirs: PASS (' + violations.length + ' misplaced dir(s) found, ' +
    empty + ' empty/pending-delete, 0 with live files)'
  );
}

main();
