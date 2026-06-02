'use strict';

// Single JS source of truth for self-origin / observation classification used by
// the incident resolver layer and any future JS consumer. Mirrors the canonical

const OBSERVATION_RE = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;

// Canonical superset of the bash _self_tags.sh and 22_lifesaver_inject SELF_TAG_RE
// tag sets. A drift-guard test (self_origin_drift.test.js) fails if either source
// gains a tag this list does not cover, forcing this to stay the superset.
const SELF_TAG_RE = /^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-runtime|proxy-bridge|proxy-watchdog|hook-watchdog|hook-stop-block|hook-runtime-error|hook-output-validation|hook-ui-echo-leak|hook-latency|hook-failure|crying_wolf|transcript-failfast|proxy-supervisor|proxy-liveness|proxy-failure|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|opencode-stderr|opencode-uncaught|opencode-unhandled-rejection|opencode-plugin|worker_client|worker:[^\]]+|autocommit:proxy|sessionstart:[^\]]+|HCI trajectory)\]/;

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
