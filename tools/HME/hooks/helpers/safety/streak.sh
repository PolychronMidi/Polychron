# Streak counter
# Weighted tool-type streak tracking. Weight guide:
#   Read=5 (0.5x), Edit/Write=10 (1x), Bash=15 (1.5x), Grep=20 (2x)
# Thresholds: warn at 50, block at 70 (equivalent to 5/7 raw calls at 1x).
_STREAK_FILE="/tmp/hme-non-hme-streak.score"
# Raw-tool streak thresholds. Base defaults (50/70) correspond to "raw-tool
# usage burning context without HME enrichment." The adaptation engine can
# nudge the warn floor via HME_STREAK_BLOCK_BUMP to reward focused work
# that's producing file_written events (see adaptation-rules.json).
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
    # Calculate how many of each tool type remain before block.
    # Weights: Bash=15, Grep=20, Edit/Write=10, Read=5.
    local _sc_bash_rem=$(( (_STREAK_BLOCK - score + 14) / 15 ))
    local _sc_edit_rem=$(( (_STREAK_BLOCK - score + 9) / 10 ))
    local _sc_read_rem=$(( (_STREAK_BLOCK - score + 4) / 5 ))
    echo "BLOCKED: Raw tool streak ${score}/${_STREAK_BLOCK} (cost: Bash=15, Edit=10, Read=5, Grep=20)." >&2
    echo "  After reset you get ~${_sc_bash_rem} Bash or ~${_sc_edit_rem} Edit or ~${_sc_read_rem} Read calls before blocking again." >&2
    echo "  Reset now: run \`i/review mode=forget\` or use native Read on the target (any HME tool clears the counter)." >&2
    echo "  HME tools add KB context that raw tools miss -- this is the designed workflow cadence." >&2
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
