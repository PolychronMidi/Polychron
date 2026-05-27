# Snapshot gate -- npm run snapshot must only fire on STABLE fingerprint
# verdict. Snapshotting an EVOLVED/DRIFTED run makes it the new baseline,
# silently erasing the signal that something drifted.
TRIMMED_CMD=$(echo "$CMD" | sed 's/^[[:space:]]*//' | head -1)
if echo "$TRIMMED_CMD" | grep -qE '^npm run snapshot\b'; then
  _FP="${PROJECT_ROOT}/src/output/metrics/fingerprint-comparison.json"
  if [ -f "$_FP" ]; then
    _VERDICT=$(_safe_jq "$(cat "$_FP")" '.verdict' 'unknown')
    # Fail-closed: 'unknown' (which _safe_jq returns for empty / malformed /
    if [ "$_VERDICT" != "STABLE" ]; then
      _emit_block "SNAPSHOT GATE: fingerprint verdict is $_VERDICT, not STABLE. Snapshotting promotes the current run to baseline -- doing that on non-STABLE erases the drift signal. Diagnose or re-run until STABLE, then snapshot. ('unknown' usually means fingerprint-comparison.json is missing or malformed.)"
      exit 2
    fi
  fi
fi
