# Streak counter
# Weighted tool-type streak tracking. Weight guide:
#   Read=5 (0.5x), Edit/Write=10 (1x), Bash=15 (1.5x), Grep=20 (2x)
# Thresholds: warn at 50, block at 70 (equivalent to 5/7 raw calls at 1x).
_STREAK_FILE="/tmp/hme-non-hme-streak.score"
# Raw-tool streak thresholds. Base defaults (50/70) correspond to "raw-tool
_STREAK_WARN=$((50 + ${HME_STREAK_BLOCK_BUMP:-0}))
_STREAK_BLOCK=$((70 + ${HME_STREAK_BLOCK_BUMP:-0}))

_streak_tick() {
  local weight="${1:-10}"
  local score
  score=$(_safe_int "$(cat "$_STREAK_FILE" 2>/dev/null)")
  score=$((score + weight))
  echo "$score" > "$_STREAK_FILE"
}

_streak_check() {
  local score
  score=$(_safe_int "$(cat "$_STREAK_FILE" 2>/dev/null)")
  if [ "$score" -ge "$_STREAK_BLOCK" ]; then
    local msg
    msg="BLOCKED: Raw tool streak ${score}/${_STREAK_BLOCK} (cost: Bash=15, Edit=10, Read=5, Grep=20). Reset now: run \`i/review mode=forget\` or use native Read on the target; HME tools clear the counter and add KB context."
    jq -n --arg reason "$msg" \
      '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
    return 1
  elif [ "$score" -ge "$_STREAK_WARN" ]; then
    local _sc_rem=$(( (_STREAK_BLOCK - score + 9) / 10 ))
    echo "REMINDER: Raw tool streak ${score}/${_STREAK_BLOCK} (~${_sc_rem} Edit calls until block). Prefer HME tools and native Read; Read/Edit are KB-enriched." >&2
  fi
  return 0
}

_streak_reset() {
  echo 0 > "$_STREAK_FILE"
}
