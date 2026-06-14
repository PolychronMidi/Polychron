'use strict';
const { requireEnv: _hmeRequireEnv } = require('../shared/load_env.js');
// Force adaptive thinking display to summarized when enabled; adaptive mode rejects budget_tokens.
// Env: HME_PROXY_FORCE_THINKING=1, HME_PROXY_THINKING_DISPLAY=summarized|omitted.

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
    if (!payload.thinking || typeof payload.thinking !== 'object') return;
    const type = String(payload.thinking.type || '').toLowerCase();
    // `display` is ONLY valid on adaptive thinking. Anthropic 400s on
    // thinking.disabled.display (and any non-adaptive .display). Strip it
    if (type !== 'adaptive') {
      if ('display' in payload.thinking) {
        delete payload.thinking.display;
        ctx.markDirty();
      }
      return;
    }
    if (payload.thinking.display === DISPLAY) return;
    payload.thinking.display = DISPLAY;
    ctx.markDirty();
  },
};
