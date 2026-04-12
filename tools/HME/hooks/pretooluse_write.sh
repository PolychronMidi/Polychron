#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_safety.sh"
# HME PreToolUse: Write — enforce lab rules, block memory saves, detect secrets
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
CONTENT=$(_safe_jq "$INPUT" '.tool_input.content' '')

# Block writes to the auto-memory directory — memory saving is an antipattern here
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  _emit_block "BLOCKED: Memory saving is an antipattern. Do not write to .claude/projects memory directory. Fix behavior, not memory."
  exit 2
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
# Enrich: inject KB context for src/ files before write proceeds
if echo "$FILE" | grep -qE '/Polychron/src/'; then
  MODULE=$(_extract_module "$FILE")
  KB_JSON=$(_hme_enrich "$MODULE")
  KB_COUNT=$(_hme_kb_count "$KB_JSON")
  if [[ "$KB_COUNT" -gt 0 ]]; then
    TITLES=$(_hme_kb_titles "$KB_JSON" 3)
    _emit_enrich_allow "Writing to $MODULE — $KB_COUNT KB constraints exist. Verify compliance: mcp__HME__read(target=\"$MODULE\", mode=\"before\")
$TITLES"
    _streak_tick 10
    exit 0
  fi
fi
_streak_tick 10
if ! _streak_check; then exit 1; fi
exit 0
