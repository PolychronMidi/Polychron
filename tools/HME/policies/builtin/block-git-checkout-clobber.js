'use strict';
/**
 * Block `git checkout HEAD~N -- .` and `git stash && git checkout`
 * patterns — both can clobber the working tree (including freshly
 * popped stashes) and require `git fsck --lost-found` recovery. Use
 * `git show HEAD~N -- <path>` (read-only stdout) or `git worktree add`
 * (isolated checkout) for prior-state inspection.
 */

// Pattern 1: `git checkout <ref> -- .` or `git checkout <ref> -- <broad-glob>`
//   The `-- .` is the canonical clobber form. Also catches `--all` and
//   bare `<ref> -- *`.
// Pattern 2: `git checkout <ref>` immediately preceded by `git stash`
//   on the same command line via `&&`, `;`, or `|`. The stash-and-
//   checkout combo specifically risks losing the popped stash.
const PATTERN_BROAD_CHECKOUT = /\bgit\s+checkout\s+\S+\s+--\s+(?:\.|\*|--all)(?=\s|$|[;&|])/;
const PATTERN_STASH_THEN_CHECKOUT = /\bgit\s+stash\b[^&;|]*?[&;|]+\s*git\s+checkout\b/;

const REASON =
  'BLOCKED: this `git checkout` pattern can clobber the working tree (including freshly-popped stashes). For prior-state inspection use `git show <ref> -- <path>` (read-only stdout) or `git worktree add /tmp/x <ref>` (isolated). See doc/HME.md or CLAUDE.md.';

module.exports = {
  name: 'block-git-checkout-clobber',
  description: 'Block `git checkout <ref> -- .` and `git stash && git checkout` patterns (working-tree clobber risk).',
  category: 'review-discipline',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (PATTERN_BROAD_CHECKOUT.test(cmd) || PATTERN_STASH_THEN_CHECKOUT.test(cmd)) {
      return ctx.deny(REASON);
    }
    return ctx.allow();
  },
};
