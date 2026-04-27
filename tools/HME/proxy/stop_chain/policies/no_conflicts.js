'use strict';
/**
 * Block stop if a git merge/rebase is in progress with unresolved conflicts.
 * Pattern lifted from FailproofAI's `require-no-conflicts-before-stop`.
 * Polychron's CLAUDE.md says "investigate before deleting or overwriting"
 * unfamiliar state — this enforces that for the most common case (an
 * abandoned rebase or merge with `<<<<<<<` markers in tracked files). spam-ok
 *
 * Detection layered: cheapest check first.
 *   1. .git/MERGE_HEAD or .git/REBASE_HEAD presence → in-progress operation.
 *   2. `git diff --name-only --diff-filter=U` → unmerged files.
 *
 * Both checks have ~ms cost on a normal repo; both fail-soft if git is
 * unavailable (returns allow rather than blocking on infrastructure issues).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PROJECT_ROOT } = require('../../shared');

function hasInProgressMergeOrRebase() {
  const gitDir = path.join(PROJECT_ROOT, '.git');
  if (!fs.existsSync(gitDir)) return null; // not a git repo — skip
  for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply']) {
    if (fs.existsSync(path.join(gitDir, marker))) return marker;
  }
  return false;
}

function unmergedFiles() {
  try {
    const out = execFileSync(
      'git',
      ['-C', PROJECT_ROOT, 'diff', '--name-only', '--diff-filter=U'],
      { encoding: 'utf8', timeout: 5_000 }
    );
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_e) {
    return null;
  }
}

module.exports = {
  name: 'no_conflicts',
  async run(ctx) {
    const inProgress = hasInProgressMergeOrRebase();
    if (inProgress === null) return ctx.allow(); // not a git repo

    const conflicted = unmergedFiles();

    if (!inProgress && (!conflicted || conflicted.length === 0)) {
      return ctx.allow();
    }

    const lines = ['CONFLICTS BLOCK STOP — unresolved git state:'];
    if (inProgress) {
      lines.push(`  - in-progress operation: ${inProgress}`);
    }
    if (conflicted && conflicted.length > 0) {
      lines.push(`  - ${conflicted.length} unmerged file(s):`);
      for (const f of conflicted.slice(0, 10)) lines.push(`      ${f}`);
      if (conflicted.length > 10) lines.push(`      ... (+${conflicted.length - 10} more)`);
    }
    lines.push('');
    lines.push('Resolve all conflicts (edit files, remove <<<<<<< / ======= / >>>>>>> markers, `git add` resolved files) and complete or abort the operation (`git rebase --continue` / `--abort`, `git merge --continue` / `--abort`) before stopping.');  // spam-ok
    return ctx.deny(lines.join('\n'));
  },
};
