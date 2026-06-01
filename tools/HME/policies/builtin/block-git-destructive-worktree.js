'use strict';
/**
 * Block destructive worktree-resetting git commands that wipe tracked
 * files. These patterns can erase entire directories silently when run
 * against a HEAD that does not contain them (e.g. `git restore --worktree`
 * against an empty-tree commit, or a `git reset --hard` to the wrong ref).
 *
 * Recovery from these is reflog-only and easy to miss; the cost of an
 * unwanted invocation is much higher than the cost of asking the user
 * to spell out the reflog-pinned ref in an authorized retry.
 */

const REASON =
  'BLOCKED: destructive worktree reset / restore patterns wipe tracked files (lesson learned 2026-05-27: `git restore --worktree --staged .` against an empty HEAD deleted tools/HME/launcher, tools/HME/proxy, tools/HME/event_kernel and more). Use `git status`, `git stash --include-untracked`, or `git worktree add <isolated-path> <ref>` to inspect prior state. If a destructive reset is genuinely needed, run it manually after confirming the target ref in `git reflog`.';

// `git restore --worktree` (any combination, with or without `--staged`,
// with or without explicit pathspec; trailing `.` / `:/` / `*` patterns).
const PATTERN_RESTORE_WORKTREE = /\bgit\s+restore\b(?=[^&;|]*--worktree\b)/;
// `git reset --hard` and `git reset --merge` discard worktree state.
const PATTERN_RESET_HARD_OR_MERGE = /\bgit\s+reset\b[^&;|]*\s(?:--hard|--merge)\b/;
// `git clean -fd` / `git clean -fdx` removes untracked files (including
// just-created edits) without prompt.
const PATTERN_CLEAN_FORCE = /\bgit\s+clean\b[^&;|]*\s-[A-Za-z]*f[A-Za-z]*\b/;
// `git checkout -- .` / `git checkout HEAD -- .` is the historical
// equivalent of `git restore .` and is already covered by the broader
const PATTERN_CHECKOUT_PATHSPEC_DOT = /\bgit\s+checkout\b[^&;|]*\s--\s+(?:\.|:\/|\*)(?=\s|$|[;&|])/;
// `git read-tree --reset -u` rewrites the index from a tree and updates
// the worktree; same blast radius as `reset --hard`.
const PATTERN_READ_TREE_RESET = /\bgit\s+read-tree\b[^&;|]*\s--reset\b[^&;|]*\s-u\b/;

const PATTERNS = [
  PATTERN_RESTORE_WORKTREE,
  PATTERN_RESET_HARD_OR_MERGE,
  PATTERN_CLEAN_FORCE,
  PATTERN_CHECKOUT_PATHSPEC_DOT,
  PATTERN_READ_TREE_RESET,
];

module.exports = {
  name: 'block-git-destructive-worktree',
  description: 'Block `git restore --worktree`, `git reset --hard|--merge`, `git clean -f*`, `git checkout -- .`, `git read-tree --reset -u` (working-tree clobber risk).',
  category: 'review-discipline',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (PATTERNS.some((re) => re.test(cmd))) return ctx.deny(REASON);
    return ctx.allow();
  },
};
