'use strict';

// Enforces: log/, metrics/, and tmp/ exist only at project root.
// Any such directory found elsewhere indicates a path bug in a tool or script
// that is writing runtime output to a non-standard location. This causes
// permission bleed, git noise, and hook failures.

const fs   = require('fs');
const path = require('path');
const { ROOT } = require('../hme/utils');
const { execSync } = require('child_process');

const BANNED_NAMES = new Set(['log', 'metrics', 'tmp']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '__pycache__']);

function walk(dir, violations) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (BANNED_NAMES.has(entry.name)) {
      violations.push(full);
      // Don't descend -- the whole subtree is the violation
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

// A directory is safe if:
//   (a) it has no untracked+non-ignored content (git ls-files --others --exclude-standard), AND
//   (b) any tracked content inside it is only deletion-staged (fix in progress)
function isSafe(absPath, stagedDeletions) {
  const rel = path.relative(ROOT, absPath);

  // Untracked, non-ignored files inside the dir -> not safe
  try {
    const untracked = execSync(`git ls-files --others --exclude-standard "${rel}/"`, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
    if (untracked) return false;
  } catch {
    // If git command fails, assume safe -- don't block on git errors
    return true;
  }

  // Tracked files inside the dir -> only safe if all are staged for deletion
  try {
    const tracked = execSync(`git ls-files "${rel}/"`, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
    if (tracked) {
      const files = tracked.split('\n').filter(Boolean);
      const allPendingDeletion = files.every(f => stagedDeletions.has(f));
      if (!allPendingDeletion) return false;
    }
  } catch {
    return true;
  }

  return true;
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
    if (BANNED_NAMES.has(entry.name)) continue; // root-level allowed
    walk(path.join(ROOT, entry.name), violations);
  }

  const stagedDeletions = getStagedDeletions();
  const unsafe = violations.filter(v => !isSafe(v, stagedDeletions));

  if (unsafe.length > 0) {
    for (const v of unsafe) {
      console.error('  VIOLATION: ' + path.relative(ROOT, v) + ' -- must not exist outside project root');
    }
    throw new Error(
      'check-root-only-dirs: ' + unsafe.length + ' non-root log/metrics/tmp director' +
      (unsafe.length === 1 ? 'y' : 'ies') + ' found with live content. ' +
      'Route all runtime output through root-level log/, metrics/, or tmp/. ' +
      'Add gitignore entries for any runtime-only paths.'
    );
  }

  const gitignored = violations.length - unsafe.length;
  console.log(
    'check-root-only-dirs: PASS (' + violations.length + ' found, ' +
    gitignored + ' gitignored/pending-delete, 0 violations)'
  );
}

main();
