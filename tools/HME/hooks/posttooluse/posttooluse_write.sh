#!/usr/bin/env bash
_HME_HELP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers"
source "$_HME_HELP_DIR/_hooks_bootstrap.sh"
# Post-write side effects are owned by proxy middleware/28_post_write_side_effects.js.
# Unfinished-todo deletion guard: a raw Write that overwrites doc/templates/TODO.md
source "$_HME_HELP_DIR/_check_errors_inline.sh"
source "$_HME_HELP_DIR/_todo_guard.sh"
INPUT=$(cat)
if ! _todo_guard_check "$INPUT"; then
  _hme_check_errors_inline || true
  exit 2
fi
printf '%s' "$INPUT" | node -e '
const fs = require("fs");
const path = require("path");
const root = process.env.PROJECT_ROOT;
let env = {};
try { env = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch (_err) { process.exit(0); }
const response = env.tool_response || env.tool_result || {};
const isError = response && (response.is_error === true || response.error === true || (Number.isInteger(response.exit_code) && response.exit_code !== 0));
const input = env.tool_input || {};
const file = input.file_path || input.path || "";
if (!file || isError) process.exit(0);
const invalidators = require(path.join(root, "tools/HME/proxy/claim_invalidators"));
const rel = path.relative(root, String(file)).replace(/\\/g, "/");
invalidators.appendInvalidator({ key: invalidators.classifyPath(rel), path: rel, source: "posttooluse_write" });
' 2>/dev/null || true
_hme_check_errors_inline || true
exit 0
