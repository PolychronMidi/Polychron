'use strict';

/* Unified agent-feedback pipeline. Wraps every <system-reminder>-style or
 * stop-hook-style injection in a canonical envelope so a single strip rule
 * in middleware/00_strip_skill_reminder.js can recognize and rotate them. */

const VALID_KINDS = new Set([
  'stop_hook',
  'proxy_status',
  'policy_warning',
  'context_inject',
  'skill_reminder',
]);

// rationale: ephemeral=true means the feedback is meant for THIS turn only;
// echoes in subsequent turns are stale replays and should be stripped.
function buildFeedback({ kind, text, source = 'hme-proxy', ephemeral = true, ttl_turns = 1 }) {
  if (!kind || !VALID_KINDS.has(kind)) {
    throw new Error(`agent_feedback: invalid kind "${kind}" (allowed: ${[...VALID_KINDS].join(',')})`);
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('agent_feedback: text must be a non-empty string');
  }
  return { kind, text, source, ephemeral, ttl_turns };
}

// rationale: canonical envelope wraps text in <system-reminder> with kind/source
// attributes; the strip table keys on this envelope shape exclusively.
function renderEnvelope(feedback) {
  const fb = buildFeedback(feedback);
  return `<system-reminder kind="${fb.kind}" source="${fb.source}">\n${fb.text}\n</system-reminder>`;
}

// rationale: strip-rule matcher used by middleware to drop stale ephemerals.
const ENVELOPE_RE = /<system-reminder kind="([^"]+)" source="([^"]+)">\n[\s\S]*?\n<\/system-reminder>/;

function isCanonicalEnvelope(text) {
  return ENVELOPE_RE.test(String(text || ''));
}

module.exports = {
  VALID_KINDS,
  buildFeedback,
  renderEnvelope,
  isCanonicalEnvelope,
  ENVELOPE_RE,
};
