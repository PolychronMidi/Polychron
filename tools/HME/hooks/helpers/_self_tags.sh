# Shared self-origin tag classifier for Lifesaver/error-surface hooks.
# Tags here identify HME infrastructure health, not agent-caused work errors.

_hme_self_tag_re() {
  printf '%s\n' '^\[(_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|hook-watchdog|hook-stop-block|hook-runtime-error|hook-output-validation|hook-ui-echo-leak|hook-latency|hook-failure|autocommit:proxy|proxy-supervisor|llamacpp_supervisor|llamacpp_offload_invariant|llamacpp_indexing_mode_resume|meta_observer|model_init|rag_proxy\.project|startup_chain|opencode-stderr|opencode-uncaught|opencode-unhandled-rejection|opencode-plugin|worker_client|worker:[^]]+|HCI trajectory)\]'
}
