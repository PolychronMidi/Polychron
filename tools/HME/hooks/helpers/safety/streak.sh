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
    echo "BLOCKED: Raw tool streak ${score}/${_STREAK_BLOCK}. Use an HME npm script (\`i/hme-read\`, \`i/review\`, \`i/trace\`, etc.) before continuing. They add KB context that raw tools miss." >&2
    return 1
  elif [ "$score" -ge "$_STREAK_WARN" ]; then
    echo "REMINDER: Raw tool streak ${score}/${_STREAK_BLOCK}. Use HME tools (read, find, review) for KB-enriched results." >&2
  fi
  return 0
}

_streak_reset() {
  echo 0 > "$_STREAK_FILE"
}
