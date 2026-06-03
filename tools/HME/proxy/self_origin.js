'use strict';

// Single JS source of truth for self-origin / observation classification used by
// the incident resolver layer and any future JS consumer. Mirrors the canonical

const OBSERVATION_RE = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;

// Canonical superset of every self-origin tag/pattern. Live consumers must NOT
// hand-maintain regex subsets; they either use SELF_TAG_RE (identity) or
// SELF_SUPPRESSED_TAG_RE/isSelfOriginSuppressed (live suppression decision that
const SELF_TAG_PATTERNS = Object.freeze([
  '_safe_curl',
  '_safe_jq',
  '_safe_py3',
  'universal_pulse',
  'supervisor',
  'hme-proxy',
  'proxy-runtime',
  'proxy-bridge',
  'proxy-watchdog',
  'hook-watchdog',
  'hook-stop-block',
  'hook-runtime-error',
  'hook-output-validation',
  'hook-ui-echo-leak',
  'hook-latency',
  'hook-failure',
  'crying_wolf',
  'transcript-failfast',
  'proxy-supervisor',
  'proxy-liveness',
  'proxy-failure',
  'llamacpp_supervisor',
  'llamacpp_offload_invariant',
  'llamacpp_indexing_mode_resume',
  'meta_observer',
  'model_init',
  'rag_proxy\\.project',
  'startup_chain',
  'opencode-stderr',
  'opencode-uncaught',
  'opencode-unhandled-rejection',
  'opencode-plugin',
  'worker_client',
  'worker:[^]]+',
  'autocommit:proxy',
  'sessionstart:[^]]+',
  'HCI trajectory',
]);

// Agent-actionable overrides: tags that match SELF_TAG_RE (they are emitted by
// HME infrastructure, so by tag they look "self-origin") BUT report a fault the
const AGENT_ACTIONABLE_OVERRIDES = new Set([
  'opencode-stderr',
  'opencode-uncaught',
  'opencode-unhandled-rejection',
  'opencode-plugin',
]);

function _tagRe(patterns) {
  return new RegExp(`^\\[(${patterns.join('|')})\\]`);
}

const SELF_SUPPRESSED_TAG_PATTERNS = Object.freeze(
  SELF_TAG_PATTERNS.filter((pattern) => !AGENT_ACTIONABLE_OVERRIDES.has(pattern))
);
const SELF_TAG_RE = _tagRe(SELF_TAG_PATTERNS);
const SELF_SUPPRESSED_TAG_RE = _tagRe(SELF_SUPPRESSED_TAG_PATTERNS);

function stripTs(line) {
  return String(line || '').replace(/^\[[0-9TZ:.-]+\]\s*/, '');
}

function isObservation(line) {
  return OBSERVATION_RE.test(stripTs(line));
}

function isSelfOrigin(line) {
  return SELF_TAG_RE.test(stripTs(line));
}

function _leadingTag(line) {
  const m = /^\[([^\]]+)\]/.exec(stripTs(line));
  return m ? m[1] : '';
}

// True when a line is agent-actionable despite matching a self-origin tag --
// i.e. the live LIFESAVER path must surface it rather than suppress it.
function isAgentActionableOverride(line) {
  return AGENT_ACTIONABLE_OVERRIDES.has(_leadingTag(line));
}

// Suppression decision for a live consumer: self-origin AND not an
// agent-actionable override. This is the behavior the live 22_lifesaver_inject
function isSelfOriginSuppressed(line) {
  return isSelfOrigin(line) && !isAgentActionableOverride(line);
}

module.exports = {
  OBSERVATION_RE,
  SELF_TAG_RE,
  AGENT_ACTIONABLE_OVERRIDES,
  stripTs,
  isObservation,
  isSelfOrigin,
  isAgentActionableOverride,
  isSelfOriginSuppressed,
};
