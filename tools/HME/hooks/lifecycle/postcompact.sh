#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PostCompact: re-surface pending KB anchors, tracked note files, and session orientation
cat > /dev/null  # consume stdin

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOKS_DIR/_nexus.sh"
source "$HOOKS_DIR/_onboarding.sh"

PROJECT="$PROJECT_ROOT"
HME_LOG="$PROJECT/log/hme.log"
printf '%s INFO compact: POST-COMPACT event triggered\n' "$(date '+%Y-%m-%d %H:%M:%S,000')" >> "$HME_LOG" 2>/dev/null
TAB="$PROJECT/tmp/hme-tab.txt"
PARTS=()

if [[ -f "$TAB" && -s "$TAB" ]]; then
  KB_LINES=$(grep '^KB:' "$TAB" 2>/dev/null)
  if [[ -n "$KB_LINES" ]]; then
    PARTS+=("POST-COMPACT: pending KB anchors still unsaved:")
    PARTS+=("$KB_LINES")
    PARTS+=("")
  fi

  FILE_LINES=$(grep '^FILE:' "$TAB" 2>/dev/null)
  if [[ -n "$FILE_LINES" ]]; then
    PARTS+=("Tracked note files from this session:")
    PARTS+=("$FILE_LINES")
  fi
fi

if [[ ${#PARTS[@]} -gt 0 ]]; then
  printf '%s\n' "${PARTS[@]}" >&2
fi

# Log post-compact event. The statusline meter hasn't fired yet with the new (reset) context value,
# so used_pct here is still the pre-compact reading — the delta between this and the next
# statusline update shows how much context was freed.
CTX_FILE="${HME_CTX_FILE:-/tmp/claude-context.json}"
LOG="$PROJECT/metrics/compact-log.jsonl"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [[ -f "$CTX_FILE" ]]; then
  USED=$(jq -r '.used_pct // "null"' "$CTX_FILE" 2>/dev/null || echo "null")
  REM=$(jq -r '.remaining_pct // "null"' "$CTX_FILE" 2>/dev/null || echo "null")
  echo "{\"ts\":\"$TS\",\"event\":\"post_compact\",\"stale_used_pct\":$USED,\"stale_remaining_pct\":$REM}" >> "$LOG"
else
  echo "{\"ts\":\"$TS\",\"event\":\"post_compact\",\"stale_used_pct\":null,\"stale_remaining_pct\":null}" >> "$LOG"
fi

# Reset context meter — compaction freed the window. Only clear token counts;
# used_pct will be written by statusLine on the next assistant message.
echo '{}' > "${HME_CTX_FILE:-/tmp/claude-context.json}"

# Re-orient after compaction — surface current session state directly
ORIENT=""
PS="$PROJECT/metrics/pipeline-summary.json"
if [ -f "$PS" ]; then
  VERDICT=$(_safe_py3 "import json; print(json.load(open('$PS')).get('verdict',''))" '')
  WALL=$(_safe_py3 "import json; d=json.load(open('$PS')); w=d.get('wallTimeSeconds',0); print(f'{w:.0f}s' if w else '')" '')
  [ -n "$VERDICT" ] && ORIENT="$ORIENT\n  Pipeline: $VERDICT${WALL:+ (${WALL})}"
fi
CHANGED=$(_safe_int "$(git -C "$PROJECT" diff --name-only 2>/dev/null | wc -l)")
[ "$CHANGED" -gt 0 ] && ORIENT="$ORIENT\n  Uncommitted: $CHANGED file(s)"
LAST_COMMIT=$(git -C "$PROJECT" log --oneline -1 2>/dev/null)
[ -n "$LAST_COMMIT" ] && ORIENT="$ORIENT\n  Last commit: $LAST_COMMIT"
PENDING=$(_nexus_pending)
[ -n "$PENDING" ] && ORIENT="$ORIENT\n  Pending:$PENDING"

# F2: Re-prime the onboarding walkthrough after compaction. If state is mid-
# walkthrough, the agent lost conversational memory of WHY they're in that
# state — reinject the current step + target so they can resume cleanly.
if ! _onb_is_graduated; then
  ONB_STEP="$(_onb_step_label)"
  ONB_TARGET="$(_onb_target)"
  ORIENT="$ORIENT\n  Onboarding: $ONB_STEP"
  [ -n "$ONB_TARGET" ] && ORIENT="$ORIENT\n  Target module: $ONB_TARGET"
fi

echo -e "[PostCompact] Context compacted. Session state:$ORIENT" >&2

# H-compact optimization #11 + #7: hydrate the new window from the latest
# chain link. This is the REAL purpose of the chain system — the new
# conversation wakes up with structured session state from the link, not
# from scratch. Dumps the link YAML to stderr so Claude sees it as part
# of post-compaction context.
LATEST_LINK="$PROJECT/metrics/chain-history/latest.yaml"
if [ -f "$LATEST_LINK" ]; then
  echo "" >&2
  echo "━━━ CHAIN LINK HYDRATION (PostCompact) ━━━" >&2
  echo "  Loading state from: $(readlink -f "$LATEST_LINK")" >&2
  python3 <<'PYEOF' 2>/dev/null >&2
import json, os
link_path = "$LATEST_LINK"
import os
project = os.environ["PROJECT_ROOT"]
latest = os.path.join(project, "metrics", "chain-history", "latest.yaml")
try:
    with open(latest) as f:
        data = json.load(f)
except Exception as e:
    print(f"[chain hydrate failed: {e}]")
    raise SystemExit(0)

# Surface the highest-signal sections:
# 1. User corrections (most fragile, most valuable)
corrections = data.get("user_corrections", [])
if corrections:
    print(f"  User corrections ({len(corrections)} this session):")
    for c in corrections[-5:]:
        print(f"    [{c.get('ts_human', '?')}] {c.get('prompt_preview', '')[:120]}")

# 2. Decision rationale (local-LLM distillation)
rationale = data.get("decision_rationale", "")
if rationale and "[local LLM unavailable" not in rationale:
    print(f"  Decision rationale: {rationale[:400]}")

# 3. HCI delta
hci = data.get("hci", {})
if hci:
    print(f"  HCI at snapshot: {hci.get('hci', '?')} | "
          f"fail_verifiers: {hci.get('fail_verifiers', [])[:3]} | "
          f"warn: {hci.get('warn_verifiers', [])[:3]}")

# 4. Git delta
gd = data.get("git_delta", {})
if gd:
    print(f"  Git delta: {len(gd.get('commits', []))} commits, "
          f"{len(gd.get('files_touched', []))} files touched")

# 5. Nexus pending
pend = data.get("nexus_pending", [])
if pend:
    print(f"  Nexus pending ({len(pend)} items):")
    for p in pend[:3]:
        print(f"    {p[:100]}")

# 6. Onboarding state
onb = data.get("onboarding", {})
if onb and onb.get("state") != "graduated":
    print(f"  Onboarding: state={onb.get('state')} target={onb.get('target', '')}")

print("  (full link readable at metrics/chain-history/latest.yaml)")
PYEOF
  echo "━━━ END CHAIN LINK HYDRATION ━━━" >&2
fi

exit 0
