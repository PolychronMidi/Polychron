#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: Read — hard-block forbidden paths, enforce pagination on huge files.
# Guards agent context against theory essays, binary models, autogen dumps, and
# append-only logs being read in full.

INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
OFFSET=$(_safe_jq "$INPUT" '.tool_input.offset' '')
LIMIT=$(_safe_jq "$INPUT" '.tool_input.limit' '')

[ -z "$FILE" ] && exit 0

# Normalize to a project-relative path. PROJECT_ROOT is set by Claude Code /
# the proxy supervisor. Fall back to absolute comparison.
REL="$FILE"
if [ -n "$PROJECT_ROOT" ] && [[ "$FILE" == "$PROJECT_ROOT"/* ]]; then
  REL="${FILE#"$PROJECT_ROOT"/}"
fi

CONFIG="${PROJECT_ROOT}/tools/HME/config/context-guards.json"
if [ ! -f "$CONFIG" ]; then
  # No config → behave as before
  exit 0
fi

# --- Hard block list: never permit any read of these paths ----------------
BLOCK_HIT=$(python3 - "$REL" "$CONFIG" <<'PYEOF' 2>/dev/null
import json, sys
rel, cfg = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(cfg))
except Exception:
    sys.exit(0)
for p in d.get("blocked_paths", []):
    # prefix match for dirs (trailing slash) or exact match for files
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
if [ -n "$BLOCK_HIT" ]; then
  _emit_block "BLOCKED: $REL matches guarded path '$BLOCK_HIT' (see tools/HME/config/context-guards.json). Full-file reads here flood agent context. If you truly need specific lines, use Grep with a targeted pattern, or read a smaller canonical file instead."
  exit 2
fi

# --- Paginated paths: require offset+limit with bounded max_lines ---------
PAG=$(python3 - "$REL" "$CONFIG" "$OFFSET" "$LIMIT" <<'PYEOF' 2>/dev/null
import json, sys
rel, cfg, offset, limit = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    d = json.load(open(cfg))
except Exception:
    sys.exit(0)
for entry in d.get("paginated_paths", []):
    prefix = entry.get("prefix", "")
    if not prefix or not rel.startswith(prefix):
        continue
    max_lines = int(entry.get("max_lines", 200))
    reason = entry.get("reason", "large append-only file")
    try:
        lim = int(limit) if limit else 0
    except Exception:
        lim = 0
    if lim == 0 or lim > max_lines:
        print(f"{max_lines}|{reason}")
    sys.exit(0)
PYEOF
)
if [ -n "$PAG" ]; then
  MAX_LINES="${PAG%%|*}"
  REASON="${PAG#*|}"
  _emit_block "BLOCKED: $REL is paginated-only ($REASON). Pass explicit limit<=$MAX_LINES and (typically) an offset. Without pagination, this read floods context."
  exit 2
fi

# --- Soft size limit: large unexplored file without offset/limit → warn ---
if [ -f "$FILE" ]; then
  SIZE=$(stat -c %s "$FILE" 2>/dev/null || echo 0)
  SOFT=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('soft_size_limit_bytes', 150000))" 2>/dev/null || echo 150000)
  if [ "$SIZE" -gt "$SOFT" ] && [ -z "$LIMIT" ] && [ -z "$OFFSET" ]; then
    echo "NEXUS: $REL is $(( SIZE / 1024 ))KB — consider passing limit/offset to Read if you only need part of it (soft threshold $(( SOFT / 1024 ))KB)." >&2
  fi
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
