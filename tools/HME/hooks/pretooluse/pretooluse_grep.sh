#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: Grep -- prevent content-mode grep from leaking guarded files.

INPUT=$(cat)
PATTERN=$(_safe_jq "$INPUT" '.tool_input.pattern' '')
SEARCH_PATH=$(_safe_jq "$INPUT" '.tool_input.path' '')
OUTPUT_MODE=$(_safe_jq "$INPUT" '.tool_input.output_mode' 'files_with_matches')
GLOB=$(_safe_jq "$INPUT" '.tool_input.glob' '')

# Only content mode is dangerous -- default (files_with_matches) and count are fine.
if [ "$OUTPUT_MODE" != "content" ]; then
  exit 0
fi

CONFIG="${PROJECT_ROOT}/tools/HME/config/context-guards.json"
[ ! -f "$CONFIG" ] && exit 0

# Normalize search path (may be absolute, relative, or empty-meaning-cwd)
REL="$SEARCH_PATH"
if [ -z "$REL" ]; then
  REL="."
fi
if [ -n "$PROJECT_ROOT" ] && [[ "$REL" == "$PROJECT_ROOT"/* ]]; then
  REL="${REL#"$PROJECT_ROOT"/}"
fi

# FAIL-LOUD: was `2>/dev/null` + bare `except: sys.exit(0)` which fail-OPENed
_PG_GATE_ERR=$(mktemp 2>/dev/null || echo "/tmp/_pg_gate_err_$$")  # silent-ok: optional fallback path.
HIT=$(python3 - "$REL" "$GLOB" "$CONFIG" <<'PYEOF' 2>"$_PG_GATE_ERR"
import json, os, sys
rel, glob, cfg = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(cfg))
for p in d.get("blocked_paths", []):
    if p.endswith("/"):
        if rel == p.rstrip("/") or rel.startswith(p):
            print(p); sys.exit(0)
    elif rel == p:
        print(p); sys.exit(0)
for entry in d.get("paginated_paths", []):
    prefix = entry.get("prefix", "")
    if prefix and (rel == prefix or (rel.endswith(prefix) and os.path.isfile(os.path.join(os.environ.get("PROJECT_ROOT",""), prefix)))):
        print(f"{prefix} (paginated-only)"); sys.exit(0)
PYEOF
)
if [ -s "$_PG_GATE_ERR" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -d "$PROJECT_ROOT/log" ]; then
  _PG_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  while IFS= read -r _pg_line; do
    [ -n "$_pg_line" ] && echo "[$_PG_TS] [pretooluse_grep:guard] python3 failed (gate fails OPEN): $_pg_line" \
      >> "$PROJECT_ROOT/log/hme-errors.log"
  done < "$_PG_GATE_ERR"
fi
rm -f "$_PG_GATE_ERR" 2>/dev/null

if [ -n "$HIT" ]; then
  _emit_block "BLOCKED: Grep output_mode='content' on guarded path '$HIT' can leak the file's contents into context. Use output_mode='files_with_matches' (default) or 'count' -- or narrow the path to a non-guarded subtree."
  exit 2
fi

_streak_tick 10
if ! _streak_check; then exit 0; fi

# KB brief: if grepping within a tracked src file, mark BRIEF so pretooluse_edit
# knows this module has been examined before any edit.
if [ -n "$SEARCH_PATH" ]; then
  _REL_PATH="$SEARCH_PATH"
  if [ -n "$PROJECT_ROOT" ] && [[ "$SEARCH_PATH" == "$PROJECT_ROOT"/* ]]; then
    _REL_PATH="${SEARCH_PATH#"$PROJECT_ROOT"/}"
  fi
  if echo "$_REL_PATH" | grep -qE '^(src|tools/HME/(mcp|activity|hooks|scripts|proxy))/'; then
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
    _MODULE=$(basename "$SEARCH_PATH" | sed 's/\.[^.]*$//')
    [ -n "$_MODULE" ] && _brief_add "$_MODULE" "pretooluse_grep"
  fi
fi
# Bounded-reads vow: counts consecutive Read/Grep/Glob.
if [ -x "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" ]; then
  PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" || exit 2
fi
exit 0
