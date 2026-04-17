#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: Grep — prevent content-mode grep from leaking guarded files.
# files_with_matches / count modes are always safe (paths/numbers only); content
# mode returns matching lines which can leak theory essay text, jsonl corpus
# entries, etc. Block content-mode when the search path or any match would land
# in a guarded directory.

INPUT=$(cat)
PATTERN=$(_safe_jq "$INPUT" '.tool_input.pattern' '')
SEARCH_PATH=$(_safe_jq "$INPUT" '.tool_input.path' '')
OUTPUT_MODE=$(_safe_jq "$INPUT" '.tool_input.output_mode' 'files_with_matches')
GLOB=$(_safe_jq "$INPUT" '.tool_input.glob' '')

# Only content mode is dangerous — default (files_with_matches) and count are fine.
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

HIT=$(python3 - "$REL" "$GLOB" "$CONFIG" <<'PYEOF' 2>/dev/null
import json, os, sys
rel, glob, cfg = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open(cfg))
except Exception:
    sys.exit(0)
# Block content-mode grep targeting guarded dirs/files
for p in d.get("blocked_paths", []):
    if p.endswith("/"):
        # Grep path inside a guarded dir
        if rel == p.rstrip("/") or rel.startswith(p):
            print(p); sys.exit(0)
    elif rel == p:
        print(p); sys.exit(0)
# Block content-mode against paginated append-only files (single-file search).
for entry in d.get("paginated_paths", []):
    prefix = entry.get("prefix", "")
    if prefix and (rel == prefix or (rel.endswith(prefix) and os.path.isfile(os.path.join(os.environ.get("PROJECT_ROOT",""), prefix)))):
        print(f"{prefix} (paginated-only)"); sys.exit(0)
PYEOF
)

if [ -n "$HIT" ]; then
  _emit_block "BLOCKED: Grep output_mode='content' on guarded path '$HIT' can leak the file's contents into context. Use output_mode='files_with_matches' (default) or 'count' — or narrow the path to a non-guarded subtree."
  exit 2
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
