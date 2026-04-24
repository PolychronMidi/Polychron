# Hook output emitters

# Emit hookSpecificOutput allow + additionalContext + systemMessage.
# additionalContext reaches Claude's next-turn context (load-bearing for
# the KB briefing / onboarding primer chain); systemMessage reaches the
# user terminal only (legacy display mirror). Previously we only emitted
# systemMessage, which meant Claude NEVER saw hook-injected briefings —
# the documented "hook-chaining" of KB briefing into Edit was silently
# broken for months. Proxy coherence_violation (inference_write_without_hme_read)
# was firing correctly against this gap the whole time.
# Usage: _emit_enrich_allow "message text"; exit 0
_emit_enrich_allow() {
  jq -n --arg msg "$1" '{"hookSpecificOutput":{"permissionDecision":"allow","additionalContext":$msg},"systemMessage":$msg}'
}

# Emit hard block decision (required format for built-in tools + hard rules).
# Outputs JSON to stdout; caller must still: exit 2
# Usage: _emit_block "BLOCKED: reason"; exit 2
_emit_block() {
  jq -n --arg reason "$1" '{"decision":"block","reason":$reason}'
}

# Path / module helpers

# Returns 0 if PATH is a project source file (src/ or HME chat/mcp).
_is_project_src() { echo "$1" | grep -qE "$_HME_SRC_PATTERN"; }

# Returns 0 if PATH is a project editable source file (adds scripts/).
_is_project_edit_src() { echo "$1" | grep -qE "$_HME_EDIT_PATTERN"; }

# Extract module name: strip directory + any file extension.
# "src/foo/barBaz.js" → "barBaz"
_extract_module() { basename "$1" | sed 's/\.[^.]*$//'; }
