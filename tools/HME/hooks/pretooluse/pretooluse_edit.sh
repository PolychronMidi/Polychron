#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
# PreToolUse: Edit — ellipsis-stub block (true pre-execution reject) + onboarding
# warn. Activity emission, BRIEF check, and KB enrichment moved to proxy middleware.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')

# Block direct edits to compiled output — edit the .ts source instead
if echo "$FILE" | grep -q "tools/HME/chat/out/"; then
  cd "${PROJECT_ROOT}/tools/HME/chat" && npx tsc 2>&1 | tail -20 >&2 || true
  _emit_block "BLOCKED: Do NOT edit files in tools/HME/chat/out/ directly — edit the .ts source in tools/HME/chat/src/ instead. tsc has been run to compile any pending src/ changes."
  exit 2
fi

# Block edits to the auto-memory directory (parity with pretooluse_write.sh).
# Memories are deprecated; HME KB (i/learn) is canonical.
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  _emit_block "BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn title=\"...\" content=\"...\" category=\"feedback\". Memories that point at behavioral rules belong in CLAUDE.md, not memory/."
  exit 2
fi

# Block edits to misplaced log/, metrics/, or tmp/ directories
if echo "$FILE" | grep -qE '/(log|tmp)/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/(log|tmp)/'; then
    _emit_block "BLOCKED: log/ and tmp/ only exist at project root. Do not edit files inside subdirectory variants. Route output through \$PROJECT_ROOT/{log,tmp}/."
    exit 2
  fi
fi
if echo "$FILE" | grep -qE '/metrics/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/output/metrics/'; then
    _emit_block "BLOCKED: metrics/ only exists at output/metrics/. Do not edit files in any other metrics/ directory."
    exit 2
  fi
fi

if echo "$NEW_STRING" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  _emit_block "BLOCKED: Edit new_string contains comment-ellipsis stub placeholder. Use the ACTUAL replacement content — no stubs."
  exit 2
fi

# Pre-save pattern lint — block new_string before it lands if it introduces
# forbidden patterns. Each block cites the rule + the fix, so the message
# alone is enough for the agent to correct the edit.
if echo "$FILE" | grep -qE '/Polychron/src/.*\.(js|ts|tsx|mjs|cjs)$'; then
  if echo "$NEW_STRING" | grep -qE '\bglobalThis\.|(^|[^a-zA-Z_])global\.[a-zA-Z_]'; then
    _emit_block "BLOCKED: new_string uses global. or globalThis. — 5 Core Principles #1 forbids these. Reference the global directly (declared in globals.d.ts)."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\|\|[[:space:]]*(0|\[\]|\{\})([^a-zA-Z0-9_]|$)'; then
    _emit_block "BLOCKED: new_string uses || 0 / || [] / || {} fallback — 5 Core Principles #2 requires fail-fast. Use validator.optionalFinite(val, fallback) or validator.create('Module') + required checks."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\.getSnapshot\(\)[[:space:]]*\.[[:space:]]*couplingMatrix'; then
    _emit_block "BLOCKED: new_string reads .couplingMatrix off getSnapshot() — forbidden outside coupling engine / meta-controllers (local/no-direct-coupling-matrix-read). Register a bias via conductorIntelligence instead."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\bconsole\.warn\b' && ! echo "$NEW_STRING" | grep -qE "console\.warn\([^)]*['\"]Acceptable warning:"; then
    _emit_block "BLOCKED: console.warn without 'Acceptable warning:' prefix — CLAUDE.md Code Style rule. Format: console.warn('Acceptable warning: <message>')."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE 'setBinaural\s*\(\s*([0-7](\.[0-9]+)?|1[3-9]|[2-9][0-9])\b'; then
    _emit_block "BLOCKED: setBinaural called outside alpha range 8–12Hz — Hard Rule (binaural is imperceptible neurostimulation only). Clamp to [8, 12]."
    exit 2
  fi

  # Semantic bugfix lookup — ask the worker if this module has a known bugfix
  # in KB that scores high against the current edit intent. High-confidence
  # hits (score ≥ 0.6) block: the edit is likely re-introducing a past bug.
  # Cache in /tmp by content hash so repeat attempts don't re-query.
  MODULE=$(basename "$FILE" | sed 's/\.[^.]*$//')
  if [ -n "$MODULE" ] && [ ${#NEW_STRING} -gt 20 ]; then
    HASH=$(printf '%s' "$NEW_STRING" | sha1sum | cut -c1-16)
    CACHE="/tmp/hme-edit-validate-$HASH.json"
    if [ ! -f "$CACHE" ]; then
      curl -s -m 2 -X POST "http://127.0.0.1:${HME_MCP_PORT:-9098}/validate" \
        -H 'Content-Type: application/json' \
        -d "{\"query\":\"$MODULE\"}" > "$CACHE" 2>/dev/null || echo '{}' > "$CACHE"
    fi
    BLOCK_HIT=$(python3 -c "
import json, sys
try:
  d = json.load(open('$CACHE'))
  for b in (d.get('blocks') if isinstance(d.get('blocks'), list) else []):
    if isinstance(b.get('score'), (int, float)) and b['score'] >= 0.6:
      print(b.get('title', '')[:120])
      break
except Exception:
  pass
" 2>/dev/null)
    if [ -n "$BLOCK_HIT" ]; then
      _emit_block "BLOCKED: KB has a bugfix entry \"$BLOCK_HIT\" that strongly matches this module. Review it via learn(query='$MODULE') before editing — the edit may re-introduce a past bug."
      exit 2
    fi
  fi
fi

if echo "$FILE" | grep -qE '/Polychron/src/' && ! _onb_is_graduated; then
  MODULE=$(_extract_module "$FILE")
  TARGET=$(_onb_target)
  if [ -n "$TARGET" ] && [ "$MODULE" != "$TARGET" ]; then
    echo "NEXUS: Editing $MODULE but onboarding target is $TARGET. Proceeding (warning, not a block)." >&2
  fi
fi

# Unbriefed-edit detection: if the Edit target is under an allow-listed
# source tree and hasn't been BRIEFed yet, emit an activity event
# (edit_without_brief) that makes this visible without falsifying the
# coherence metric. Auto-BRIEFing here would defeat the metric's purpose
# (it measures "did agent read before edit?" — auto-BRIEF on edit lies).
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy|config))/'; then
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
  _auto_module=$(_extract_module "$FILE")
  if [ -n "$_auto_module" ] && ! _nexus_has BRIEF "$_auto_module"; then
    if [ -x "$PROJECT_ROOT/tools/HME/activity/emit.py" ]; then
      python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
        --event=edit_without_brief \
        --file="$FILE" \
        --module="$_auto_module" \
        --session="$(whoami 2>/dev/null || echo shell)" \
        >/dev/null 2>&1 &
    fi
  fi
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
