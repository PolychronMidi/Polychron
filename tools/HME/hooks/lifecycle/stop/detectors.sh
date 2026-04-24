# Consolidated detector run
# All 6 stop-side detectors (poll_count / idle_after_bg / psycho_stop /
# ack_skip / abandon_check / stop_work) run in ONE python3 invocation via
# run_all.py — parse the transcript once, share the cache, amortize the
# ~400ms python-interpreter startup that used to fire per detector.
# Previous p95 was 5.5s (n=78); consolidated is ~170ms on small
# transcripts, grows sub-linearly with transcript size.
TRANSCRIPT_PATH=$(_safe_jq "$INPUT" '.transcript_path' '')
POLL_COUNT=0
IDLE_AFTER_BG=ok
PSYCHO_STOP=ok
ACK_SKIP=ok
ABANDON_CHECK=ok
STOP_WORK=ok
FABRICATION_CHECK=ok
EARLY_STOP=ok
EXHAUST_CHECK=ok
if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  # run_all.py prints one `name=verdict` line per detector. Parse into bash vars.
  # If run_all crashes we fall back to defaults above (equivalent to old
  # `|| echo ok` per-detector fallbacks).
  _RUN_ALL_OUT=$(timeout 3 python3 "$_DETECTORS_DIR/run_all.py" "$TRANSCRIPT_PATH" 2>/dev/null || true)
  while IFS='=' read -r _k _v; do
    case "$_k" in
      poll_count)    POLL_COUNT="$_v" ;;
      idle_after_bg) IDLE_AFTER_BG="$_v" ;;
      psycho_stop)   PSYCHO_STOP="$_v" ;;
      ack_skip)      ACK_SKIP="$_v" ;;
      abandon_check) ABANDON_CHECK="$_v" ;;
      stop_work)     STOP_WORK="$_v" ;;
      fabrication_check) FABRICATION_CHECK="$_v" ;;
      early_stop)    EARLY_STOP="$_v" ;;
      exhaust_check) EXHAUST_CHECK="$_v" ;;
    esac
  done <<< "$_RUN_ALL_OUT"
  # Sanity: poll_count must be numeric for the -ge test below.
  [[ "$POLL_COUNT" =~ ^[0-9]+$ ]] || POLL_COUNT=0
fi
