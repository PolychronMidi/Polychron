#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: Read -- hard-block forbidden paths, enforce pagination on huge files.

INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
OFFSET=$(_safe_jq "$INPUT" '.tool_input.offset' '')
LIMIT=$(_safe_jq "$INPUT" '.tool_input.limit' '')

[ -z "$FILE" ] && exit 0

if [ "${HME_VERIFY_LANDED_OK:-0}" != "1" ]; then
  _VLR_TURN_EDITS="${PROJECT_ROOT:-}/tmp/hme-turn-edits.txt"
  if [ -s "$_VLR_TURN_EDITS" ]; then
    _VLR_BASE=$(basename "$FILE" 2>/dev/null | sed 's/\.[^.]*$//')  # silent-ok: optional fallback path.
    if [ -n "$_VLR_BASE" ] && grep -qFx "$_VLR_BASE" "$_VLR_TURN_EDITS" 2>/dev/null; then  # silent-ok: optional fallback path.
      _emit_block "BLOCKED: verify-landed antipattern -- Read of $_VLR_BASE which was Edit/Written this turn. The Edit tool already returned [SUCCESS] as explicit confirmation; re-reading is context-burn."
      exit 2
    fi
  fi
fi

# Block reads of the deprecated memory directory. Reading (even just to
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  _emit_block "BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn query=\"<what you're looking for>\". Memory files are not the source of truth for project knowledge."
  exit 2
fi

# Normalize to a project-relative path. PROJECT_ROOT is set by Claude Code /
# the proxy supervisor. Fall back to absolute comparison.
REL="$FILE"
if [ -n "$PROJECT_ROOT" ] && [[ "$FILE" == "$PROJECT_ROOT"/* ]]; then
  REL="${FILE#"$PROJECT_ROOT"/}"
fi

CONFIG="${PROJECT_ROOT}/tools/HME/config/context-guards.json"
if [ ! -f "$CONFIG" ]; then
  # No config -> behave as before
  exit 0
fi

# Hard block list: never permit any read of these paths.
_PR_GATE_ERR=$(mktemp 2>/dev/null || echo "/tmp/_pr_gate_err_$$")  # silent-ok: optional fallback path.
BLOCK_HIT=$(python3 - "$REL" "$CONFIG" <<'PYEOF' 2>"$_PR_GATE_ERR"
import json, sys
rel, cfg = sys.argv[1], sys.argv[2]
d = json.load(open(cfg))
for p in d.get("blocked_paths", []):
    if p.endswith("/"):
        if rel.startswith(p):
            print(p); sys.exit(0)
    elif rel == p:
        print(p); sys.exit(0)
for ext in d.get("blocked_extensions", []):
    if rel.endswith(ext):
        print(f"*{ext}"); sys.exit(0)
PYEOF
)
if [ -s "$_PR_GATE_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
  _PR_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  while IFS= read -r _pr_line; do
    [ -n "$_pr_line" ] && echo "[$_PR_TS] [pretooluse_read:blocklist] python3 failed (gate fails OPEN until fixed): $_pr_line" \
      >> "$PROJECT_ROOT/log/hme-errors.log"
  done < "$_PR_GATE_ERR"
fi
rm -f "$_PR_GATE_ERR" 2>/dev/null
if [ -n "$BLOCK_HIT" ]; then
  _emit_block "BLOCKED: $REL matches guarded path '$BLOCK_HIT' (see tools/HME/config/context-guards.json). Full-file reads here flood agent context. If you truly need specific lines, use Grep with a targeted pattern, or read a smaller canonical file instead."
  exit 2
fi

# Paginated paths: require offset+limit with bounded max_lines.
# FAIL-LOUD: same rationale as the blocklist gate above.
_PR_PAG_ERR=$(mktemp 2>/dev/null || echo "/tmp/_pr_pag_err_$$")  # silent-ok: optional fallback path.
PAG=$(python3 - "$REL" "$CONFIG" "$OFFSET" "$LIMIT" <<'PYEOF' 2>"$_PR_PAG_ERR"
import json, sys
rel, cfg, offset, limit = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = json.load(open(cfg))
for entry in d.get("paginated_paths", []):
    prefix = entry.get("prefix", "")
    if not prefix or not rel.startswith(prefix):
        continue
    max_lines = int(entry.get("max_lines", 200))
    reason = entry.get("reason", "large append-only file")
    try:
        lim = int(limit) if limit else 0
    except (ValueError, TypeError):
        lim = 0
    if lim == 0 or lim > max_lines:
        print(f"{max_lines}|{reason}")
    sys.exit(0)
PYEOF
)
if [ -s "$_PR_PAG_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
  _PR_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  while IFS= read -r _pr_line; do
    [ -n "$_pr_line" ] && echo "[$_PR_TS] [pretooluse_read:paginated] python3 failed: $_pr_line" \
      >> "$PROJECT_ROOT/log/hme-errors.log"
  done < "$_PR_PAG_ERR"
fi
rm -f "$_PR_PAG_ERR" 2>/dev/null
if [ -n "$PAG" ]; then
  MAX_LINES="${PAG%%|*}"
  REASON="${PAG#*|}"
  _emit_block "BLOCKED: $REL is paginated-only ($REASON). Pass explicit limit<=$MAX_LINES and (typically) an offset. Without pagination, this read floods context."
  exit 2
fi

#  Soft size limit: large unexplored file without offset/limit -> warn
if [ -f "$FILE" ]; then
  SIZE=$(stat -c %s "$FILE" 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
  # FAIL-LOUD: corrupted config silently produced default-150000 soft limit.
  _PR_SOFT_ERR=$(mktemp 2>/dev/null || echo "/tmp/_pr_soft_err_$$")  # silent-ok: optional fallback path.
  SOFT=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('soft_size_limit_bytes', 150000))" 2>"$_PR_SOFT_ERR" || echo 150000)
  if [ -s "$_PR_SOFT_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
    _PR_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
    while IFS= read -r _pr_line; do
      [ -n "$_pr_line" ] && echo "[$_PR_TS] [pretooluse_read:soft-limit] python3 failed: $_pr_line" \
        >> "$PROJECT_ROOT/log/hme-errors.log"
    done < "$_PR_SOFT_ERR"
  fi
  rm -f "$_PR_SOFT_ERR" 2>/dev/null
  if [ "$SIZE" -gt "$SOFT" ] && [ -z "$LIMIT" ] && [ -z "$OFFSET" ]; then
    echo "NEXUS: $REL is $(( SIZE / 1024 ))KB -- consider passing limit/offset to Read if you only need part of it (soft threshold $(( SOFT / 1024 ))KB)." >&2
  fi
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
# Bounded-reads vow: counts consecutive Read/Grep/Glob; warns/blocks at HME_READ_BUDGET.
if [ -x "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" ]; then
  PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" || exit 2
fi
exit 0
