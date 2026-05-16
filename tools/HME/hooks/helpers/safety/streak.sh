# Streak counter
# Weighted tool-type streak tracking. Weight guide:
#   Edit/Write=10 (1x), Bash=15 (1.5x), Grep=20 (2x); Read resets.
# Thresholds come from tools/HME/config/raw-streak.json (+ HME_STREAK_BLOCK_BUMP).
_STREAK_LEGACY_FILE="/tmp/hme-non-hme-streak.score"
_STREAK_LEGACY_LAST_UNLOCK="/tmp/hme-non-hme-streak.last_unlock"
# Raw-tool streak thresholds. Base defaults (50/70) correspond to "raw-tool
_STREAK_POLICY_FILE="${PROJECT_ROOT:-}/tools/HME/config/raw-streak.json"
_streak_policy_value() {
  local expr="$1" fallback="$2"
  if [ -f "$_STREAK_POLICY_FILE" ]; then
    jq -r "$expr // \"$fallback\"" "$_STREAK_POLICY_FILE" 2>/dev/null || printf '%s\n' "$fallback"
  else
    printf '%s\n' "$fallback"
  fi
}
_STREAK_WARN_BASE="$(_streak_policy_value '.warn_score' '50')"
_STREAK_BLOCK_BASE="$(_streak_policy_value '.block_score' '70')"
_STREAK_COST_SUMMARY="$(_streak_policy_value '.cost_summary' 'Bash=15, Grep=20; native Read/Edit reset')"
_STREAK_PREFERRED_EXIT="$(_streak_policy_value '.preferred_exit' 'use native Read/Edit/TodoWrite, run a different HME diagnostic class, or stop if done')"
_STREAK_REMINDER="$(_streak_policy_value '.reminder' 'Prefer HME tools; native Read/Edit reset and are KB-enriched.')"
_STREAK_WARN=$((_STREAK_WARN_BASE + ${HME_STREAK_BLOCK_BUMP:-0}))
_STREAK_BLOCK=$((_STREAK_BLOCK_BASE + ${HME_STREAK_BLOCK_BUMP:-0}))

_streak_tick() {
  local weight="${1:-10}"
  local score
  score=$(_streak_score)
  score=$((score + weight))
  _streak_write score "$score"
}

_streak_check() {
  local score last_info last_key
  score=$(_streak_score)
  if [ "$score" -ge "$_STREAK_BLOCK" ]; then
    local unlock_key last_unlock
    unlock_key="$(_streak_unlock_key "${CMD:-}")"
    last_info="$(_streak_read last_unlock)"
    last_key="${last_info#*$'\t'}"
    if [ -n "$unlock_key" ]; then
      if _streak_same_unlock_class "$unlock_key" "$last_info"; then
        local repeat_msg prev
        prev="${last_key:-$last_info}"
        repeat_msg="BLOCKED: Raw tool streak unlock loop detected. Previous unlock: \`${prev}\`; requested: \`${unlock_key}\`. ${_STREAK_PREFERRED_EXIT}."
        jq -n --arg reason "$repeat_msg" \
          '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
        return 1
      fi
      return 0
    fi
    local msg
    msg="BLOCKED: Raw tool streak ${score}/${_STREAK_BLOCK} (cost: ${_STREAK_COST_SUMMARY}). Do not loop on reset commands. Preferred exits: ${_STREAK_PREFERRED_EXIT}${last_key:+ (${last_key})}."
    jq -n --arg reason "$msg" \
      '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
    return 1
  elif [ "$score" -ge "$_STREAK_WARN" ] && [ "${HME_STREAK_WARN_VISIBLE:-0}" = "1" ]; then
    local _sc_rem=$(( (_STREAK_BLOCK - score + 9) / 10 ))
    echo "REMINDER: Raw tool streak ${score}/${_STREAK_BLOCK} (~${_sc_rem} Edit calls until block). ${_STREAK_REMINDER}" >&2
  fi
  return 0
}

_streak_hme_precheck() {
  local cmd="${1:-}" unlock_key last_info last_key score
  unlock_key="$(_streak_unlock_key "$cmd")"
  [ -n "$unlock_key" ] || return 2
  score=$(_streak_score)
  last_info="$(_streak_read last_unlock)"
  last_key="${last_info#*$'\t'}"
  if [ "$score" -ge "$_STREAK_BLOCK" ] && _streak_same_unlock_class "$unlock_key" "$last_info"; then
    local repeat_msg prev
    prev="${last_key:-$last_info}"
    repeat_msg="BLOCKED: Raw tool streak unlock loop detected. Previous unlock: \`${prev}\`; requested: \`${unlock_key}\`. ${_STREAK_PREFERRED_EXIT}."
    jq -n --arg reason "$repeat_msg" \
      '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":$reason},"systemMessage":$reason}'
    return 1
  fi
  if [ "$score" -ge "$_STREAK_BLOCK" ]; then
    _streak_record_unlock "$unlock_key"
  fi
  _streak_write score 0
  return 0
}

_streak_scope_file() {
  local kind="${1:-score}" sid safe dir
  sid="${SESSION_ID:-}"
  if [ -z "$sid" ] && [ -n "${INPUT:-}" ]; then
    sid="$(_safe_jq "$INPUT" '.session_id' '')"
  fi
  [ -n "$sid" ] || sid="no-session"
  safe=$(printf '%s' "$sid" | tr -c 'A-Za-z0-9_.-' '_' | cut -c1-120)
  if [ -n "${PROJECT_ROOT:-}" ]; then
    dir="$PROJECT_ROOT/tmp/hme-streak"
  else
    dir="/tmp/hme-streak"
  fi
  mkdir -p "$dir" 2>/dev/null || true
  printf '%s/%s.%s\n' "$dir" "$safe" "$kind"
}

_streak_read() {
  local kind="${1:-score}" scoped legacy
  scoped="$(_streak_scope_file "$kind")"
  legacy="$_STREAK_LEGACY_FILE"
  [ "$kind" = "last_unlock" ] && legacy="$_STREAK_LEGACY_LAST_UNLOCK"
  if [ -f "$scoped" ]; then cat "$scoped" 2>/dev/null || true; return; fi
  cat "$legacy" 2>/dev/null || true
}

_streak_write() {
  local kind="${1:-score}" value="${2:-}" scoped
  scoped="$(_streak_scope_file "$kind")"
  printf '%s\n' "$value" > "$scoped"
}

_streak_score() {
  _safe_int "$(_streak_read score)"
}

_streak_record_unlock() {
  local key="$1" cls
  cls="$(_streak_unlock_class "$key")"
  _streak_write last_unlock "${cls}"$'\t'"${key}"
}

_streak_same_unlock_class() {
  local key="$1" last="$2" cls last_cls
  [ -n "$key" ] && [ -n "$last" ] || return 1
  cls="$(_streak_unlock_class "$key")"
  last_cls="${last%%$'\t'*}"
  if [ "$last_cls" = "$last" ]; then last_cls="$(_streak_unlock_class "$last")"; fi
  [ -n "$cls" ] && [ "$cls" = "$last_cls" ]
}

_streak_unlock_class() {
  local key="$1" tool rest
  tool="${key%% *}"
  rest=" ${key#"$tool"} "
  case "$tool" in
    i/review)
      if printf '%s' "$rest" | grep -qE '(^|[[:space:]])(--[[:space:]]+)?(mode=)?forget([[:space:]]|$)'; then
        echo "review-reset"
      elif printf '%s' "$rest" | grep -qE '(^|[[:space:]])(mode=)?digest([[:space:]]|$)'; then
        echo "review-digest"
      else
        echo "review"
      fi
      ;;
    i/status) echo "status" ;;
    codex/read) echo "structured-read" ;;
    codex/edit) echo "structured-edit" ;;
    i/learn) echo "learn" ;;
    i/trace) echo "trace" ;;
    i/evolve) echo "evolve" ;;
    i/hme) echo "hme-admin" ;;
    i/audit) echo "audit" ;;
    i/why) echo "why" ;;
    i/policies) echo "policies" ;;
    *) echo "$tool" ;;
  esac
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
    elif base == "codex_structured_tool.js" or tok.endswith("tools/HME/scripts/codex_structured_tool.js"):
        action = tokens[i + 1] if i + 1 < len(tokens) else ""
        if action in {"read", "edit"}:
            norm = f"codex/{action}"
            start = i + 2
    if not norm:
        continue
    args = []
    for arg in tokens[start:]:
        if arg in {";", "&", "|", "||", "&&", "(", ")"}:
            break
        if arg == "--":
            continue
        args.append(arg)
    print(" ".join([norm] + args))
    break
PY
}

_streak_reset() {
  local score unlock_key
  score=$(_streak_score)
  unlock_key="$(_streak_unlock_key "${1:-${CMD:-}}")"
  if [ "$score" -ge "$_STREAK_BLOCK" ] && [ -n "$unlock_key" ]; then
    _streak_record_unlock "$unlock_key"
  fi
  _streak_write score 0
}
