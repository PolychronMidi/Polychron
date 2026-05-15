# Hook output emitters

# Emit hookSpecificOutput allow + additionalContext + systemMessage.
_emit_enrich_allow() {
  jq -n --arg msg "$1" '{"hookSpecificOutput":{"permissionDecision":"allow","additionalContext":$msg},"systemMessage":$msg}'
}

# Emit hard block decision (required format for built-in tools + hard rules).
_emit_block() {
  jq -n --arg reason "$1" '{"decision":"block","reason":$reason}'
}

# Path / module helpers

# Returns 0 if PATH is a project source file (src/ or tools/).
_is_project_src() { echo "$1" | grep -qE "$_HME_SRC_PATTERN"; }

# Returns 0 if PATH is a project editable source file (adds scripts/).
_is_project_edit_src() { echo "$1" | grep -qE "$_HME_EDIT_PATTERN"; }

# Extract module name: strip directory + any file extension.
# "src/foo/barBaz.js" -> "barBaz"
_extract_module() { basename "$1" | sed 's/\.[^.]*$//'; }
