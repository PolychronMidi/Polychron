# Nexus lifecycle audit
# If there are unreviewed EDITs, BLOCK and force the agent to run
#   i/review mode=forget
# The agent is fully capable of calling that directly via the Bash(i/review …)
# wrapper, so we no longer attempt the old auto-audit workaround (which
# silently cleared EDITs when the narrow /audit KB-hit check returned no
# violations — bypassing review entirely). Every edit must be reviewed.
#
# Supplemental check: /audit is still called to SURFACE specific KB hits
# (bugfix / antipattern / architecture entries relevant to changed modules)
# in the block message, but a clean audit NO LONGER clears the backlog.
# Only a completed `i/review` (detected by nexus_tracking.js adding a REVIEW
# marker) clears EDITs.
source "${_HME_HELPERS_DIR}/_nexus.sh"

# Prune net-zero edits (edited then reverted in the same/prior turn) so
# the block decision reflects true divergence from HEAD, not raw Edit
# tool call counts. Without this, an implement+revert sequence wedges
# NEXUS into demanding reviews of changes that no longer exist.
_nexus_prune_clean_edits

_MCP_PORT="${HME_MCP_PORT:-9098}"
_EDIT_COUNT=$(_nexus_count EDIT)
if [ "$_EDIT_COUNT" -gt 0 ]; then
  # Surface any KB-relevant architectural hits for the changed modules.
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

NEXUS_ISSUES=$(_nexus_pending)
if [ -n "$NEXUS_ISSUES" ]; then
  jq -n \
    --arg issues "$NEXUS_ISSUES" \
    '{"decision":"block","reason":("NEXUS — incomplete lifecycle steps:" + $issues + "\n\nFinish these before stopping.")}'
  exit 0
fi
