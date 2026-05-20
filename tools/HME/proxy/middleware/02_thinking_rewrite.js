'use strict';
const { requireEnv: _hmeRequireEnv } = require('../shared/load_env.js');
/**
 * Force `thinking.display: "summarized"` so Opus 4.7's adaptive thinking
 * returns visible summarized thinking text instead of empty/omitted blocks.
 *
 * Why: on Claude Opus 4.7 the API DEFAULT is `display: "omitted"` -- the
 * model still does internal reasoning, but the `thinking` field comes
 * back empty (only the encrypted `signature` is returned). Claude Code's
 * VSCode extension does not set `display`, so users see blank thinking
 * blocks even with `alwaysThinkingEnabled: true` + `verbose: true`.
 *
 * What this does NOT do (don't be tempted to "fix" these):
 * - DOES NOT change `thinking.type`. On Opus 4.7, `adaptive` is the
 *   ONLY supported mode -- `type: "enabled"` is rejected with 400.
 * - DOES NOT add `budget_tokens`. Adaptive mode rejects budget_tokens.
 *
 * Reference: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
 *
 * Env gate:
 *   HME_PROXY_FORCE_THINKING=1                 enable rewrite (default 0)
 *   HME_PROXY_THINKING_DISPLAY=summarized      summarized|omitted (default summarized)
 */

const ENABLED = process.env.HME_PROXY_FORCE_THINKING === '1';
const DISPLAY = (() => {
  const raw = (_hmeRequireEnv('HME_PROXY_THINKING_DISPLAY')).toLowerCase();
  return (raw === 'omitted') ? 'omitted' : 'summarized';
})();

module.exports = {
  name: 'thinking_rewrite',
  onRequest({ payload, ctx }) {
    if (!ENABLED) return;
    if (!payload) return;
    // Only act when thinking is already configured (don't enable thinking
    if (!payload.thinking || typeof payload.thinking !== 'object') return;
    if (payload.thinking.display === DISPLAY) return;
    payload.thinking.display = DISPLAY;
    ctx.markDirty();
  },
};
