'use strict';
/**
 * Block broad checkout clobbers plus direct restore of unified TODO state.
 */

// Pattern 1: `git checkout <ref> -- .` or `git checkout <ref> -- <broad-glob>`
const PATTERN_BROAD_CHECKOUT = /\bgit\s+checkout\s+\S+\s+--\s+(?:\.|\*|--all)(?=\s|$|[;&|])/;
const PATTERN_STASH_THEN_CHECKOUT = /\bgit\s+stash\b[^&;|]*?[&;|]+\s*git\s+checkout\b/;
const TODO_STATE_PATHS = ['doc/templates/TODO.md', 'tools/HME/KB/todos.json'];

const REASON =
  'BLOCKED: this `git checkout` pattern can clobber the working tree (including freshly-popped stashes). For prior-state inspection use `git show <ref> -- <path>` (read-only stdout) or `git worktree add /tmp/x <ref>` (isolated). See doc/self-coherence.md or AGENTS.md.';
const TODO_REASON =
  'BLOCKED: TODO.md and todos.json are unified task state; use native plan/update_plan/TODO.md sync surfaces instead.';

function touchesTodoState(cmd) {
  return TODO_STATE_PATHS.some((p) => cmd.includes(p));
}

function restoresTodoState(cmd) {
  if (!touchesTodoState(cmd)) return false;
  return /\bgit\s+(?:checkout|restore)\b/.test(cmd);
}

module.exports = {
  name: 'block-git-checkout-clobber',
  description: 'Block `git checkout <ref> -- .` and `git stash && git checkout` patterns (working-tree clobber risk).',
  category: 'review-discipline',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (restoresTodoState(cmd)) return ctx.deny(TODO_REASON);
    if (PATTERN_BROAD_CHECKOUT.test(cmd) || PATTERN_STASH_THEN_CHECKOUT.test(cmd)) {
      return ctx.deny(REASON);
    }
    return ctx.allow();
  },
};
