#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
INPUT=$(cat)
printf '%s' "$INPUT" | node -e '
const fs = require("fs");
const path = require("path");
const root = process.env.PROJECT_ROOT || process.cwd();
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
exit 0
