# Early-firing EDIT-count gate. Splits the original nexus_audit.sh in two —
# this half runs IMMEDIATELY after _preamble so a downstream sub-script
# silently `exit 0`-ing the chain can no longer bypass the unreviewed-edit
# block. (Verified failure mode: the chain finished in 117ms with 22 EDITs
# present but no block emitted — some early script died via the only
# bypass path the dispatcher's `set +u +e` defence cannot catch.)
#
# The companion `_nexus_pending` lifecycle audit still runs at its original
# late position (nexus_pending.sh) because that check needs autocommit /
# detectors / pipeline verdict state set by intervening sub-scripts.
source "${_HME_HELPERS_DIR}/_nexus.sh"

# Prune net-zero edits (file matches HEAD — typical edit-then-revert).
# Without this, NEXUS demands review of changes that no longer exist.
_nexus_prune_clean_edits

_MCP_PORT="${HME_MCP_PORT:-9098}"
_EDIT_COUNT=$(_nexus_count EDIT)
if [ "$_EDIT_COUNT" -gt 0 ]; then
  # Surface KB-relevant architectural hits for the changed modules.
  _AUDIT=$(curl -s -m 10 -X POST "http://127.0.0.1:${_MCP_PORT}/audit" \
    -H 'Content-Type: application/json' \
    -d '{"changed_files":""}' 2>/dev/null || true)
  _HINT_TEXT=$(echo "$_AUDIT" | python3 -c '
import sys, json
d = json.loads(sys.stdin.read() or "{}")
hints = d.get("violations", [])
if hints:
    print("\n\nKB hits for changed modules (review these in context):")
    for h in hints[:5]:
        print("  - {}: {}".format(h.get("file", "?"), h.get("title", h.get("message", ""))))
' 2>/dev/null || echo "")
  jq -n \
    --arg count "$_EDIT_COUNT" \
    --arg hints "$_HINT_TEXT" \
    '{"decision":"block","reason":("NEXUS — " + $count + " unreviewed edit(s). Run `i/review mode=forget` before stopping." + $hints)}'
  exit 0
fi
