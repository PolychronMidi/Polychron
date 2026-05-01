'use strict';
/**
 * Prune Claude Code's default system prompt of sections that HME
 * supersedes or that aren't load-bearing for this project.
 *
 * The biggest offender: the `# auto memory` section (~7-8KB, ~130 lines)
 * teaches the agent about a file-based `~/.claude/projects/<slug>/memory/`
 * directory with four memory types (user/feedback/project/reference) and
 * full XML-tagged examples. HME's KB (`i/learn`) is the project's
 * canonical durable-knowledge surface; the auto-memory directive
 * constantly primes the agent to write to a competing path.
 *
 * Cache behavior: Anthropic prompt-caches the system block for ~5 min
 * after first send. As long as our mutation is deterministic (same input
 * → same output), the pruned prompt is itself cache-stable — subsequent
 * requests still hit `cache_read_input_tokens`. The model just sees a
 * shorter, less spammy prompt every turn.
 *
 * Position in order.json: AFTER dump_system (so the raw capture stays
 * available for inspection) but BEFORE all HME injection middleware
 * (since prune operates on Claude Code's blocks, not on what HME adds).
 *
 * Toggles via env (each defaults to its sensible default; off = 0):
 *   HME_PRUNE_MEMORY_SECTION  default 1 — strip `# auto memory` through `# Environment`
 *   HME_PRUNE_FAST_MODE       default 0 — strip the Fast mode line
 *   HME_PRUNE_FRONTEND_NOTE   default 0 — strip the UI/frontend dev-server bullet
 *   HME_PRUNE_SCHEDULE_NUDGE  default 0 — strip the "/schedule offer" guidance
 */

const PRUNE_MEMORY = (process.env.HME_PRUNE_MEMORY_SECTION ?? '1') !== '0';
const PRUNE_FAST = (process.env.HME_PRUNE_FAST_MODE ?? '0') !== '0';
const PRUNE_FRONTEND = (process.env.HME_PRUNE_FRONTEND_NOTE ?? '0') !== '0';
const PRUNE_SCHEDULE = (process.env.HME_PRUNE_SCHEDULE_NUDGE ?? '0') !== '0';

function pruneText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  if (PRUNE_MEMORY) {
    // Cut from `# auto memory` heading through to (but not including)
    // `# Environment`. Multi-line dotall so the whole section goes.
    out = out.replace(/(^|\n)# auto memory[\s\S]*?(?=\n# Environment\b)/, '$1');
  }
  if (PRUNE_FAST) {
    out = out.replace(/^[^\n]* Fast mode for Claude Code [^\n]*\n/m, '');
  }
  if (PRUNE_FRONTEND) {
    out = out.replace(/^ - For UI or frontend changes,[^\n]*\n/m, '');
  }
  if (PRUNE_SCHEDULE) {
    // The /schedule offer guidance is one long bullet inside `# Session-specific guidance`.
    out = out.replace(/^ - When work you just finished has a natural future follow-up,[^\n]*\n/m, '');
  }
  return out;
}

module.exports = {
  name: 'prune_system',
  onRequest({ payload, ctx }) {
    if (!payload || payload.system == null) return;
    if (Array.isArray(payload.system)) {
      let mutated = false;
      for (const block of payload.system) {
        if (!block || typeof block.text !== 'string') continue;
        const before = block.text;
        const after = pruneText(before);
        if (after !== before) {
          block.text = after;
          mutated = true;
        }
      }
      if (mutated) ctx.markDirty();
    } else if (typeof payload.system === 'string') {
      const after = pruneText(payload.system);
      if (after !== payload.system) {
        payload.system = after;
        ctx.markDirty();
      }
    }
  },
};
