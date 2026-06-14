#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../helpers/_hooks_bootstrap.sh"
source "$SCRIPT_DIR/../helpers/_check_errors_inline.sh"
source "$SCRIPT_DIR/../helpers/_todo_guard.sh"
INPUT=$(cat)
if ! _todo_guard_check "$INPUT"; then
  _hme_check_errors_inline || true
  exit 2
fi
printf '%s' "$INPUT" | node -e '
const fs = require("fs");
const path = require("path");
const root = process.env.PROJECT_ROOT;
const invalidators = require(path.join(root, "tools/HME/proxy/claim_invalidators"));
let env = {};
try { env = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch (_err) { process.exit(0); }
const response = env.tool_response || env.tool_result || {};
const isError = response && (response.is_error === true || response.error === true || (Number.isInteger(response.exit_code) && response.exit_code !== 0));
const text = typeof response === "string" ? response : JSON.stringify(response || {});
if (isError || /\b(old_string not found|old_string is not unique|Error:)\b/.test(text)) process.exit(0);
const input = env.tool_input || {};
const file = input.file_path || input.path || "";
if (!file) process.exit(0);
const base = path.basename(String(file)).replace(/\.[^.]*$/, "");
if (!base) process.exit(0);
fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
fs.appendFileSync(path.join(root, "tmp", "hme-turn-edits.txt"), `${base}\n`);
' 2>/dev/null || true
# Onboarding: targeted -> edited the moment a src/ Edit lands successfully.
# Canonical machine (onboarding_states.json) has no separate briefed state;
_EDIT_FILE=$(_safe_jq "$INPUT" '.tool_input.file_path // .tool_input.path' '')
_EDIT_ERR=$(_safe_jq "$INPUT" '.tool_response.is_error // .tool_result.is_error // false' 'false')
# Match the project's own src/ via $PROJECT_ROOT (portable) rather than a
# hardcoded /Polychron/ fragment, so this fires in any clone -- and so the
case "$_EDIT_FILE" in
  "${PROJECT_ROOT}/src/"*) _EDIT_IN_SRC=1 ;;
  *) _EDIT_IN_SRC=0 ;;
esac
if [ "$_EDIT_ERR" != "true" ] && [ "$_EDIT_IN_SRC" = "1" ] \
   && ! _onb_is_graduated && [ "$(_onb_state)" = "targeted" ]; then
  _onb_advance_to edited
fi
_hme_check_errors_inline || true
exit 0
