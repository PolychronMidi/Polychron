# Late lifecycle audit. The companion early gate (nexus_edit_check.sh) has
# already enforced the EDIT-count block at the top of the chain; this stage
# checks remaining lifecycle markers (PIPELINE verdict, COMMIT_FAILED, large
# REVIEW_ISSUES count) that depend on autocommit/detectors/pipeline state
# set by intervening sub-scripts.
source "${_HME_HELPERS_DIR}/_nexus.sh"

NEXUS_ISSUES=$(_nexus_pending)
if [ -n "$NEXUS_ISSUES" ]; then
  jq -n \
    --arg issues "$NEXUS_ISSUES" \
    '{"decision":"block","reason":("NEXUS — incomplete lifecycle steps:" + $issues + "\n\nFinish these before stopping.")}'
  exit 0
fi
