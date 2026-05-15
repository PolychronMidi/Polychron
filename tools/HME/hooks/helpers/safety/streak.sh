# Streak counter
# Weighted tool-type streak tracking. Weight guide:
#   Read=5 (0.5x), Edit/Write=10 (1x), Bash=15 (1.5x), Grep=20 (2x)
# Thresholds: warn at 50, block at 70 (equivalent to 5/7 raw calls at 1x).
_STREAK_FILE="/tmp/hme-non-hme-streak.score"
_STREAK_LAST_UNLOCK="/tmp/hme-non-hme-streak.last_unlock"
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
    local unlock_key last_unlock
    unlock_key="$(_streak_unlock_key "${CMD:-}")"
    last_unlock="$(cat "$_STREAK_LAST_UNLOCK" 2>/dev/null || true)"
    if [ -n "$unlock_key" ]; then
      if [ -n "$last_unlock" ] && [ "$unlock_key" = "$last_unlock" ]; then
        local repeat_msg
        repeat_msg="BLOCKED: Raw tool streak unlock loop detected. The same HME command (\`${unlock_key}\`) was the previous unlock command; use native Read/Edit/Todo sync or a different HME diagnostic instead of repeating the same reset."
        jq -n --arg reason "$repeat_msg" \
          '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
        return 1
      fi
      return 0
    fi
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

_streak_unlock_key() {
  local cmd="${1:-}"
  [ -n "$cmd" ] || return 0
  PROJECT_ROOT="${PROJECT_ROOT:-}" python3 - "$cmd" <<'PY' 2>/dev/null || true
import os, shlex, sys
cmd = (sys.argv[1] or "").strip().splitlines()[0]
tools = {"review", "learn", "trace", "evolve", "status", "hme", "audit", "why", "policies"}
try:
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()")
    lex.whitespace_split = True
    tokens = list(lex)
except Exception:
    tokens = cmd.split()
for i, tok in enumerate(tokens):
    if tok in {";", "&", "|", "||", "&&", "(", ")"}:
        continue
    base = os.path.basename(tok)
    norm = ""
    start = i + 1
    if base in tools and (tok.startswith("i/") or tok.startswith("./i/") or "/i/" in tok):
        norm = f"i/{base}"
    elif tok.endswith("scripts/hme-cli.js") or tok == "scripts/hme-cli.js":
        tool = tokens[i + 1] if i + 1 < len(tokens) else ""
        if tool in tools:
            norm = f"i/{tool}"
            start = i + 2
    if not norm:
        continue
    args = []
    for arg in tokens[start:]:
        if arg in {";", "&", "|", "||", "&&", "(", ")"}:
            break
        args.append(arg)
    print(" ".join([norm] + args))
    break
PY
}

_streak_reset() {
  local score unlock_key
  score=$(_safe_int "$(cat "$_STREAK_FILE" 2>/dev/null)")
  unlock_key="$(_streak_unlock_key "${1:-${CMD:-}}")"
  if [ "$score" -ge "$_STREAK_BLOCK" ] && [ -n "$unlock_key" ]; then
    echo "$unlock_key" > "$_STREAK_LAST_UNLOCK"
  fi
  echo 0 > "$_STREAK_FILE"
}
