#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PreToolUse: Write — enforce lab rules, block memory saves, detect secrets
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
CONTENT=$(_safe_jq "$INPUT" '.tool_input.content' '')

# Block direct writes to compiled output — edit the .ts source instead
if echo "$FILE" | grep -q "tools/HME/chat/out/"; then
  cd "${PROJECT_ROOT}/tools/HME/chat" && npx tsc 2>&1 | tail -20 >&2 || true
  _emit_block "BLOCKED: Do NOT write files in tools/HME/chat/out/ directly — edit the .ts source in tools/HME/chat/src/ instead. tsc has been run to compile any pending src/ changes."
  exit 2
fi

# Block writes to the auto-memory directory — HME KB is the canonical
# place for cross-session knowledge. Memory writes here are an
# antipattern: they're invisible to the rest of the system, can't be
# semantically searched, and accumulate without retirement.
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  _emit_block "BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn title=\"...\" content=\"...\" category=\"feedback\". Memories that point at behavioral rules belong in CLAUDE.md, not memory/."
  exit 2
fi

# Block writes to misplaced log/, metrics/, or tmp/ directories
if echo "$FILE" | grep -qE '/(log|tmp)/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/(log|tmp)/'; then
    _emit_block "BLOCKED: log/ and tmp/ only exist at project root. Do not write files inside subdirectory variants. Route output through \$PROJECT_ROOT/{log,tmp}/."
    exit 2
  fi
fi
if echo "$FILE" | grep -qE '/metrics/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/output/metrics/'; then
    _emit_block "BLOCKED: metrics/ only exists at output/metrics/. Do not write files in any other metrics/ directory."
    exit 2
  fi
fi

# Detect secret patterns in content (API keys, tokens, passwords)
if echo "$CONTENT" | grep -qE '(api[_-]?key|password|secret|token)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9+/]{20,}'; then
  _emit_block "BLOCKED: Potential secret/credential detected in write content. Review before writing."
  exit 2
fi

# Block stub/placeholder writes — LLM-generated code with comment-ellipsis elision patterns
# destroys files by replacing real content with placeholder references.
if echo "$CONTENT" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  _emit_block "BLOCKED: Write contains comment-ellipsis stub placeholder. This destroys files. Write the COMPLETE file content or use Edit for partial changes."
  exit 2
fi
if echo "$CONTENT" | grep -qE '\.\.\. rest of (file|implementation|code)'; then
  _emit_block "BLOCKED: Write contains ellipsis-rest-of stub placeholder. Write complete content or use Edit."
  exit 2
fi

if echo "$FILE" | grep -q 'lab/sketches.js'; then
  echo 'LAB RULES: Every postBoot() must create AUDIBLE behavior via real monkey-patching. No empty sketches. Do not use V (validator) -- use Number.isFinite directly. Do not use crossLayerHelpers -- use inline layer logic. Do not return values from void functions (playNotesEmitPick returns void).' >&2
fi
# fix_antipattern: expected background failures must be logger.info, not logger.warning.
# Only genuine critical failures (interactive timeout, HTTP 500, connection refused) stay as warning.
# Catches: logger.warning(...background...) and logger.warning(...warm...failed/error...) in HME server code.
if echo "$FILE" | grep -q 'tools/HME/mcp/server'; then
  if echo "$CONTENT" | grep -qE 'logger\.warning\(.*\b(background|warm.*fail|warm.*error|onnx.*failed|VRAM TIGHT|lazy warm)\b'; then
    _emit_block "BLOCKED: Expected background failure logged as WARNING — use logger.info. Only critical failures (interactive timeout, HTTP 500) should be WARNING in HME server. See ANTIPATTERN: stderr-to-UI popup spam."
    exit 2
  fi
fi
# Enrich: semantic-validate src/ writes via /validate. Blocks on high-confidence
# bugfix match (score ≥ 0.6); emits category-aware enrichment notice on warnings.
if echo "$FILE" | grep -qE '/Polychron/src/'; then
  MODULE=$(_extract_module "$FILE")
  VAL_CACHE="/tmp/hme-write-validate-$(printf '%s' "$MODULE" | sha1sum | cut -c1-16).json"
  if [ ! -f "$VAL_CACHE" ]; then
    curl -s -m 2 -X POST "http://127.0.0.1:${HME_MCP_PORT:-9098}/validate" \
      -H 'Content-Type: application/json' \
      -d "{\"query\":\"$MODULE\"}" > "$VAL_CACHE" 2>/dev/null || echo '{}' > "$VAL_CACHE"
  fi
  BLOCK_HIT=$(python3 -c "
import json
try:
  d = json.load(open('$VAL_CACHE'))
  for b in (d.get('blocks') if isinstance(d.get('blocks'), list) else []):
    if isinstance(b.get('score'), (int, float)) and b['score'] >= 0.6:
      print(b.get('title', '')[:120])
      break
except Exception:
  pass
" 2>/dev/null)
  if [ -n "$BLOCK_HIT" ]; then
    _emit_block "BLOCKED: KB has a bugfix entry \"$BLOCK_HIT\" strongly matching this module. Review with learn(query='$MODULE') before writing."
    exit 2
  fi
  WARN_TITLES=$(python3 -c "
import json
try:
  d = json.load(open('$VAL_CACHE'))
  ws = d.get('warnings') if isinstance(d.get('warnings'), list) else []
  bs = d.get('blocks') if isinstance(d.get('blocks'), list) else []
  titles = []
  for h in (bs + ws):
    if isinstance(h.get('score'), (int, float)) and h['score'] >= 0.45:
      t = str(h.get('title', ''))[:100]
      if t: titles.append(t)
    if len(titles) >= 3: break
  print('\n'.join(titles))
except Exception:
  pass
" 2>/dev/null)
  if [ -n "$WARN_TITLES" ]; then
    _emit_enrich_allow "Writing to $MODULE — KB rules/antipatterns may apply:
$WARN_TITLES"
    _streak_tick 10
    exit 0
  fi
fi
_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
