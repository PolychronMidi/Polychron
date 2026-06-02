'use strict';

// Single JS source of truth for self-origin / observation classification used by
// the incident resolver layer and any future JS consumer. Mirrors the canonical

const OBSERVATION_RE = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;

const SELF_TAG_RE = /^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-runtime|proxy-bridge|proxy-watchdog|hook-watchdog|hook-latency|crying_wolf|proxy-supervisor|proxy-liveness|proxy-failure|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|opencode-stderr|opencode-uncaught|opencode-unhandled-rejection|opencode-plugin|worker_client|worker:[^\]]+|autocommit:proxy)\]/;

function stripTs(line) {
  return String(line || '').replace(/^\[[0-9TZ:.-]+\]\s*/, '');
}

function isObservation(line) {
  return OBSERVATION_RE.test(stripTs(line));
}

function isSelfOrigin(line) {
  return SELF_TAG_RE.test(stripTs(line));
}

module.exports = { OBSERVATION_RE, SELF_TAG_RE, stripTs, isObservation, isSelfOrigin };
