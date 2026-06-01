'use strict';

const STARTUP_GRACE_MS = 90_000;

function isStartupGraceTurn(ctx) {
  const text = String(ctx.shared && ctx.shared.lastRealUserText || '').trim().toLowerCase();
  if (!['hi', 'hello', 'hey'].includes(text)) return false;
  const payload = ctx.payload || {};
  const startMs = Number(payload.session_start_time_ms || payload.start_time_ms || 0);
  return startMs <= 0 || Date.now() - startMs <= STARTUP_GRACE_MS;
}

const missingUserPromptCheck = {
  name: 'missing-user-prompt',
  evaluate(state) { return state.lastUser ? null : state.ctx.allow(); },
};

const startupGraceCheck = {
  name: 'startup-grace',
  evaluate(state) {
    state.ctx.shared = state.ctx.shared || {};
    state.ctx.shared.lastRealUserText = state.lastUser;
    return isStartupGraceTurn(state.ctx) ? state.ctx.allow() : null;
  },
};

const noisePromptCheck = {
  name: 'noise-prompt',
  evaluate(state) {
    const t = String(state.lastUser).trim().toLowerCase();
    return (!t || /^(?:undefined|null|continue|ok|k|standby|standing\s*by|\.|\?+|\s+)$/.test(t))
      ? state.ctx.allow()
      : null;
  },
};

const missingTranscriptCheck = {
  name: 'missing-transcript',
  evaluate(state) { return state.transcriptPath ? null : state.ctx.allow(); },
};

module.exports = {
  isStartupGraceTurn,
  missingTranscriptCheck,
  missingUserPromptCheck,
  noisePromptCheck,
  startupGraceCheck,
};
