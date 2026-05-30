'use strict';

// Single source of truth for input shortcuts, shared by the proxy request
// rewriter (middleware/00a_shortcuts_rewriter) and the Claude UserPromptSubmit

const SHORTCUTS = {
  n: 'next suggestions?',
  m: "what's missing?",
  d: 'do all',
  c: 'continue',
  r: 'restarted. continue',
};

// Two-step shortcuts submit `first`, then auto-submit `second` as a genuine
// follow-up user message (round-trip in hme_proxy_anthropic_response).
const TWO_STEP_SHORTCUTS = {
  1: { first: "reply only with 'hi'", second: "reply only with 'high'" },
  cc: { first: '/compact', second: 'continue' },
};

// Text a typed shortcut expands to for the on-screen input bubble. Two-step
// shortcuts show their `first` message -- the actual user message submitted this
function shortcutDisplay(text) {
  const key = String(text == null ? '' : text).trim().toLowerCase();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(SHORTCUTS, key)) return SHORTCUTS[key];
  if (Object.prototype.hasOwnProperty.call(TWO_STEP_SHORTCUTS, key)) return TWO_STEP_SHORTCUTS[key].first;
  return null;
}

module.exports = { SHORTCUTS, TWO_STEP_SHORTCUTS, shortcutDisplay };
