'use strict';
const { requireEnv: _hmeRequireEnv } = require('../../../../tools/HME/proxy/shared/load_env.js');

// Enforces canonical log/tmp plus approved project and HME metrics roots.
// Any instance elsewhere indicates a path bug writing runtime output to a non-standard location.

const fs   = require('fs');
const path = require('path');
const ROOT = _hmeRequireEnv('PROJECT_ROOT');
const { execSync } = require('child_process');

// log/ and tmp/ stay root-only; metrics has project and HME roots.
// These root names are source/runtime split violations after bifurcation.
const ROOT_ONLY_NAMES = new Set(['log', 'tmp']);
const ROOT_FORBIDDEN_NAMES = new Set(['output', 'i', 'runtime', 'lab']);
const ALLOWED_METRICS_RELS = new Set([
  path.join('src', 'output', 'metrics'),
  path.join('tools', 'HME', 'runtime', 'metrics'),
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '__pycache__']);
const ROOT_FORBIDDEN_FILE_PATTERNS = [
  { re: /\.jsonl$/i, reason: 'JSONL runtime/test artifacts belong under src/output/metrics/, tools/HME/runtime/, log/, or tmp/' }
];

function walk(dir, violations) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (path.dirname(full) === ROOT && ROOT_FORBIDDEN_NAMES.has(entry.name)) {
      violations.push(full);
      continue;
    }
    if (ROOT_ONLY_NAMES.has(entry.name)) {
      violations.push(full);
      // Don't descend -- the whole subtree is the violation
    } else if (entry.name === 'metrics') {
      const rel = path.relative(ROOT, full);
      if (!ALLOWED_METRICS_RELS.has(rel)) {
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
      if (line[0] === 'D' || line[1] === 'D') {
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
function rootFileViolations(entries, stagedDeletions) {
  const violations = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (stagedDeletions.has(entry.name)) continue;
    for (const pattern of ROOT_FORBIDDEN_FILE_PATTERNS) {
      if (pattern.re.test(entry.name)) {
        violations.push({ file: entry.name, reason: pattern.reason });
        break;
      }
    }
  }
  return violations;
}

function isSafe(absPath, stagedDeletions) {
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
    if (ROOT_FORBIDDEN_NAMES.has(entry.name)) { violations.push(path.join(ROOT, entry.name)); continue; }
    // metrics/ at root level is a violation.
    if (entry.name === 'metrics') { violations.push(path.join(ROOT, entry.name)); continue; }
    walk(path.join(ROOT, entry.name), violations);
  }

  const stagedDeletions = getStagedDeletions();
  const unsafe = violations.filter(v => !isSafe(v, stagedDeletions));
  const fileViolations = rootFileViolations(entries, stagedDeletions);

  if (unsafe.length > 0 || fileViolations.length > 0) {
    for (const v of unsafe) {
      console.error('  VIOLATION: ' + path.relative(ROOT, v) + ' -- misplaced root/runtime directory');
    }
    for (const v of fileViolations) {
      console.error('  VIOLATION: ' + v.file + ' -- ' + v.reason);
    }
    throw new Error(
      'check-root-only-dirs: ' + unsafe.length + ' misplaced log/metrics/tmp director' +
      (unsafe.length === 1 ? 'y' : 'ies') + ' and ' + fileViolations.length +
      ' forbidden root file(s) found. log/ and tmp/ must be at project root; ' +
      'metrics/ must be in approved project/HME roots; root output/, i/, lab/, and runtime/ are forbidden.'
    );
  }

  const empty = violations.length - unsafe.length;
  console.log(
    'check-root-only-dirs: PASS (' + violations.length + ' misplaced dir(s) found, ' +
    empty + ' empty/pending-delete, 0 with live files, ' + fileViolations.length +
    ' forbidden root file(s))'
  );
}

main();
